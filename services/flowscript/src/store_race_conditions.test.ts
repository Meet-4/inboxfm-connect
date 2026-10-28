import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finishRun, getStorePool, setStorePool } from './store.js'

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
