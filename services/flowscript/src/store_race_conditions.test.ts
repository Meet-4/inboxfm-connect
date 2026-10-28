import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enqueueWebhook, finishRun, getStorePool, hashWebhookToken, publishFlow, setStorePool } from './store.js'
import type { FlowIR } from './compiler.js'

describe('flowscript store race conditions (publish version conflicts)', () => {
  let versions: Array<{ projectId: string; flowName: string; version: number }>
  let insertAttempts: number
  // Simulates another process committing a version of this flow between our
  // SELECT MAX(version) and our INSERT (trips the UNIQUE constraint).
  let concurrentCommitVersion: number | null
  // Forces every INSERT to fail with a unique violation (exhaustion path).
  let alwaysConflict: boolean
  let insertError: Error | null
  let mockPool: any
  let originalPool: any

  const ir = {
    irVersion: 1 as const,
    name: 'race-flow',
    version: 1,
    trigger: { kind: 'manual' as const },
    inputSchema: {},
    steps: [],
  } as unknown as FlowIR

  beforeEach(() => {
    versions = []
    insertAttempts = 0
    concurrentCommitVersion = null
    alwaysConflict = false
    insertError = null
    originalPool = getStorePool()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()

      if (trimmed.startsWith('SELECT COALESCE(MAX(version), 0)::int AS version FROM flowscript_versions')) {
        const [projectId, flowName] = params
        const max = versions
          .filter(v => v.projectId === projectId && v.flowName === flowName)
          .reduce((acc, v) => Math.max(acc, v.version), 0)
        return { rows: [{ version: max }], rowCount: 1 }
      }

      if (trimmed.startsWith('INSERT INTO flowscript_versions')) {
        insertAttempts++
        if (insertError) throw insertError
        const [, projectId, flowName, version] = params
        if (alwaysConflict || concurrentCommitVersion !== null) {
          if (concurrentCommitVersion !== null) {
            // The concurrent transaction's row becomes visible to later snapshots
            versions.push({ projectId, flowName, version: concurrentCommitVersion })
            concurrentCommitVersion = null
          }
          const err = new Error('duplicate key value violates unique constraint "flowscript_versions_project_id_flow_name_version_key"')
          ;(err as any).code = '23505'
          throw err
        }
        versions.push({ projectId, flowName, version })
        return { rows: [], rowCount: 1 }
      }

      if (trimmed === 'BEGIN' || trimmed === 'COMMIT' || trimmed === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }

      return { rows: [], rowCount: 0 }
    }

    mockPool = {
      query: (sql: string, params?: any[]) => executeQuery(sql, params ?? []),
      connect: async () => ({
        query: (sql: string, params?: any[]) => executeQuery(sql, params ?? []),
        release: () => {},
      }),
      end: async () => {},
    }

    setStorePool(mockPool)
  })

  afterEach(() => {
    setStorePool(originalPool)
  })

  it('retries with a fresh version lookup when a concurrent publish wins the same version', async () => {
    // A concurrent publish of the same flow commits version 1 between our
    // SELECT (returned 0) and our INSERT, so our first insert conflicts.
    concurrentCommitVersion = 1

    const published = await publishFlow('proj-race', 'source-text', ir, 'hash-1')

    expect(insertAttempts).toBe(2)
    expect(published.version).toBe(2)
    // The concurrent publish's version 1 and our retried version 2 both persist
    expect(versions).toHaveLength(2)
    expect(versions[0]).toMatchObject({ projectId: 'proj-race', flowName: 'race-flow', version: 1 })
    expect(versions[1]).toMatchObject({ projectId: 'proj-race', flowName: 'race-flow', version: 2 })
  })

  it('resolves a version bump deterministically without conflicts', async () => {
    versions.push({ projectId: 'proj-race', flowName: 'race-flow', version: 4 })

    const published = await publishFlow('proj-race', 'source-text', ir, 'hash-1')

    expect(insertAttempts).toBe(1)
    expect(published.version).toBe(5)
    expect(versions).toHaveLength(2)
  })

  it('surfaces non-conflict insert errors immediately without retrying', async () => {
    insertError = new Error('connection refused')

    await expect(publishFlow('proj-race', 'source-text', ir, 'hash-1')).rejects.toThrow('connection refused')
    expect(insertAttempts).toBe(1)
  })

  it('gives up after repeated conflicts instead of retrying forever', async () => {
    alwaysConflict = true

    await expect(publishFlow('proj-race', 'source-text', ir, 'hash-1')).rejects.toThrow(/duplicate key value/)
    expect(insertAttempts).toBe(3)
  })
})

describe('flowscript store race conditions (webhook idempotency conflict resolution)', () => {
  let triggers: Map<string, any>
  let deployments: Map<string, any>
  let committedIdempotencies: Map<string, string>
  let committedRuns: Set<string>
  let pendingRunInserts: Set<string>
  let raceWinner: { triggerId: string; key: string; runId: string } | null
  let raceWinnerVanishes: boolean
  let raceCommitted: boolean
  let mockPool: any
  let originalPool: any

  beforeEach(() => {
    triggers = new Map()
    deployments = new Map()
    committedIdempotencies = new Map()
    committedRuns = new Set()
    pendingRunInserts = new Set()
    raceWinner = null
    raceWinnerVanishes = false
    raceCommitted = false
    originalPool = getStorePool()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()

      if (trimmed.includes("FROM flowscript_triggers WHERE kind='webhook' AND enabled=true AND secret_hash=$1")) {
        const [secretHash] = params
        for (const t of triggers.values()) {
          if (t.kind === 'webhook' && t.enabled && t.secret_hash === secretHash) {
            return { rows: [{ id: t.id, project_id: t.project_id, flow_name: t.flow_name, environment: t.environment }], rowCount: 1 }
          }
        }
        return { rows: [], rowCount: 0 }
      }

      if (trimmed.includes('FROM flowscript_deployments WHERE project_id=$1 AND flow_name=$2 AND environment=$3')) {
        const [projectId, flowName, env] = params
        for (const d of deployments.values()) {
          if (d.project_id === projectId && d.flow_name === flowName && d.environment === env && d.status === 'active') {
            return { rows: [{ version_id: d.version_id }], rowCount: 1 }
          }
        }
        return { rows: [], rowCount: 0 }
      }

      if (trimmed.includes('FROM flowscript_webhook_idempotency WHERE trigger_id=$1 AND idempotency_key=$2')) {
        const [triggerId, key] = params
        const composite = `${triggerId}:${key}`
        // The concurrent winner is only visible to snapshots taken after its commit
        if (raceWinner && !raceCommitted) {
          return { rows: [], rowCount: 0 }
        }
        const runId = committedIdempotencies.get(composite)
        return runId ? { rows: [{ run_id: runId }], rowCount: 1 } : { rows: [], rowCount: 0 }
      }

      if (trimmed.includes('INSERT INTO flowscript_runs')) {
        const [id] = params
        pendingRunInserts.add(id)
        return { rows: [], rowCount: 1 }
      }

      if (trimmed.includes('INSERT INTO flowscript_webhook_idempotency')) {
        const [, triggerId, key, runId] = params
        const composite = `${triggerId}:${key}`
        const conflict = (raceWinner && !raceCommitted && raceWinner.triggerId === triggerId && raceWinner.key === key)
          || committedIdempotencies.has(composite)
        if (conflict) {
          if (raceWinner && !raceWinnerVanishes) {
            // The concurrent transaction commits its idempotency record + run now
            committedIdempotencies.set(`${raceWinner.triggerId}:${raceWinner.key}`, raceWinner.runId)
            committedRuns.add(raceWinner.runId)
            raceCommitted = true
          }
          // ON CONFLICT (trigger_id, idempotency_key) DO NOTHING -> 0 rows
          return { rows: [], rowCount: 0 }
        }
        committedIdempotencies.set(composite, runId)
        return { rows: [{ run_id: runId }], rowCount: 1 }
      }

      if (trimmed === 'BEGIN') {
        pendingRunInserts = new Set()
        return { rows: [], rowCount: 0 }
      }
      if (trimmed === 'COMMIT') {
        for (const id of pendingRunInserts) committedRuns.add(id)
        return { rows: [], rowCount: 0 }
      }
      if (trimmed === 'ROLLBACK') {
        pendingRunInserts = new Set()
        return { rows: [], rowCount: 0 }
      }

      return { rows: [], rowCount: 0 }
    }

    mockPool = {
      query: (sql: string, params?: any[]) => executeQuery(sql, params ?? []),
      connect: async () => ({
        query: (sql: string, params?: any[]) => executeQuery(sql, params ?? []),
        release: () => {},
      }),
      end: async () => {},
    }

    setStorePool(mockPool)
  })

  afterEach(() => {
    setStorePool(originalPool)
  })

  const setupTrigger = () => {
    const token = 'a'.repeat(43)
    const triggerId = '00000000-0000-0000-0000-0000000000t1'
    triggers.set(triggerId, {
      id: triggerId,
      kind: 'webhook',
      enabled: true,
      secret_hash: hashWebhookToken(token),
      project_id: 'proj-wh',
      flow_name: 'hooked-flow',
      environment: 'production',
    })
    deployments.set('dep-1', {
      project_id: 'proj-wh',
      flow_name: 'hooked-flow',
      environment: 'production',
      version_id: '00000000-0000-0000-0000-0000000000v1',
      status: 'active',
    })
    return token
  }

  it('returns the winning delivery\'s run id after losing the idempotency insert race', async () => {
    const token = setupTrigger()
    raceWinner = { triggerId: '00000000-0000-0000-0000-0000000000t1', key: 'evt-777', runId: '00000000-0000-0000-0000-0000000000win' }

    const result = await enqueueWebhook(token, { hello: 'world' }, 'evt-777')

    expect(result).toEqual({ runId: '00000000-0000-0000-0000-0000000000win', duplicate: true })
    // The losing transaction's run insert must not survive its rollback
    expect(committedRuns.has('00000000-0000-0000-0000-0000000000win')).toBe(true)
    expect(committedRuns.size).toBe(1)
  })

  it('never returns the rolled-back run id when the winner cannot be found', async () => {
    const token = setupTrigger()
    raceWinner = { triggerId: '00000000-0000-0000-0000-0000000000t1', key: 'evt-888', runId: '00000000-0000-0000-0000-0000000000win' }
    raceWinnerVanishes = true // winner row never becomes visible (defensive path)

    await expect(enqueueWebhook(token, { hello: 'world' }, 'evt-888')).rejects.toThrow(
      /could not be resolved after rollback/,
    )
    // No phantom run from the rolled-back transaction was surfaced or persisted
    expect(committedRuns.size).toBe(0)
  })
})

describe('flowscript store race conditions (finalization ownership)', () => {
  let runs: Map<string, any>
  let finishCalls: Array<{ id: string; status: string; owner: string | undefined; scoped: boolean }>
  let mockPool: any
  let originalPool: any

  beforeEach(() => {
    runs = new Map()
    finishCalls = []
    originalPool = getStorePool()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()

      if (trimmed.includes("SET status=CASE WHEN status='cancelled' THEN 'cancelled' ELSE $2 END")) {
        const scoped = trimmed.includes('AND worker_id=$7')
        const [id, status, output, steps, error, cancellationReason, owner] = params
        finishCalls.push({ id, status, owner, scoped })
        const run = runs.get(id)
        if (!run) return { rows: [], rowCount: 0 }
        if (scoped && run.worker_id !== owner) {
          // Simulates row not matching WHERE id=$1 AND worker_id=$7
          return { rows: [], rowCount: 0 }
        }
        if (run.status === 'cancelled') {
          // CASE expression preserves a user-initiated cancellation
          run.cancellation_reason = cancellationReason ?? run.cancellation_reason
          run.output = output ? JSON.parse(output) : null
          run.steps = steps ? JSON.parse(steps) : []
          run.error = error
          run.finished_at = new Date()
        } else {
          run.status = status
          run.output = output ? JSON.parse(output) : null
          run.steps = steps ? JSON.parse(steps) : []
          run.error = error
          run.cancellation_reason = cancellationReason ?? run.cancellation_reason
          run.finished_at = new Date()
        }
        return { rows: [{ id }], rowCount: 1 }
      }

      return { rows: [], rowCount: 0 }
    }

    mockPool = {
      query: (sql: string, params?: any[]) => executeQuery(sql, params ?? []),
      connect: async () => ({
        query: (sql: string, params?: any[]) => executeQuery(sql, params ?? []),
        release: () => {},
      }),
      end: async () => {},
    }

    setStorePool(mockPool)
  })

  afterEach(() => {
    setStorePool(originalPool)
  })

  it('applies a scoped finish for the worker that owns the run', async () => {
    const runId = '00000000-0000-0000-0000-0000000000a1'
    runs.set(runId, { id: runId, status: 'running', worker_id: 'worker-a' })

    const applied = await finishRun(runId, { status: 'succeeded', steps: [{ id: 's1', status: 'succeeded', durationMs: 1 }] }, 'worker-a')

    expect(applied).toBe(1)
    expect(runs.get(runId).status).toBe('succeeded')
    expect(finishCalls[0].scoped).toBe(true)
    expect(finishCalls[0].owner).toBe('worker-a')
  })

  it('zombie worker cannot finalize a run that was re-queued (worker_id=NULL)', async () => {
    // Worker A's lease expired; recoverStaleRuns re-queued the run (worker_id=NULL)
    // and worker B may already have re-claimed it. A's late finishRun must no-op.
    const runId = '00000000-0000-0000-0000-0000000000a2'
    runs.set(runId, { id: runId, status: 'queued', worker_id: null })

    const applied = await finishRun(runId, { status: 'cancelled', steps: [], error: 'Execution cancelled', cancellationReason: 'Execution cancelled' }, 'worker-a')

    expect(applied).toBe(0)
    expect(runs.get(runId).status).toBe('queued')
    expect(runs.get(runId).finished_at).toBeUndefined()
  })

  it('zombie worker cannot finalize a run re-claimed by a different worker', async () => {
    const runId = '00000000-0000-0000-0000-0000000000a3'
    runs.set(runId, { id: runId, status: 'running', worker_id: 'worker-b' })

    const applied = await finishRun(runId, { status: 'failed', steps: [], error: 'boom' }, 'worker-a')

    expect(applied).toBe(0)
    expect(runs.get(runId).status).toBe('running')
    expect(runs.get(runId).finished_at).toBeUndefined()
  })

  it('zombie worker cannot downgrade an "uncertain" run to "succeeded"', async () => {
    // recoverStaleRuns marked the run uncertain after a non-idempotent step may have
    // fired; worker_id was cleared. The zombie's success must not hide that state.
    const runId = '00000000-0000-0000-0000-0000000000a4'
    runs.set(runId, { id: runId, status: 'uncertain', worker_id: null })

    const applied = await finishRun(runId, { status: 'succeeded', steps: [] }, 'worker-a')

    expect(applied).toBe(0)
    expect(runs.get(runId).status).toBe('uncertain')
  })

  it('scoped finish still preserves a user-initiated cancellation for the owning worker', async () => {
    const runId = '00000000-0000-0000-0000-0000000000a5'
    runs.set(runId, { id: runId, status: 'cancelled', worker_id: 'worker-a', cancellation_reason: 'Cancelled by user' })

    const applied = await finishRun(runId, { status: 'succeeded', steps: [{ id: 's1', status: 'succeeded', durationMs: 2 }] }, 'worker-a')

    expect(applied).toBe(1)
    expect(runs.get(runId).status).toBe('cancelled')
    expect(runs.get(runId).cancellation_reason).toBe('Cancelled by user')
  })

  it('legacy unscoped finishRun (no owner) still matches rows regardless of worker_id', async () => {
    const runId = '00000000-0000-0000-0000-0000000000a6'
    runs.set(runId, { id: runId, status: 'running', worker_id: 'someone-else' })

    const applied = await finishRun(runId, { status: 'succeeded', steps: [] })

    expect(applied).toBe(1)
    expect(runs.get(runId).status).toBe('succeeded')
    expect(finishCalls[0].scoped).toBe(false)
  })
})
