import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRun, getStorePool, MAX_IDEMPOTENCY_KEY_LENGTH, setStorePool } from './store.js'
import { buildServer, signProjectId } from './server.js'

/**
 * Idempotency-key handling for POST /v1/flows/:name/run.
 *
 * Two defects are covered here:
 *
 * 1. Keys are scoped to (project, flow, environment). The dedupe lookup and the
 *    unique index used to key on project_id alone, so reusing a key for another
 *    flow replayed that flow's run, returned its runId to a caller that asked for
 *    a different flow, and silently dropped the requested run.
 * 2. Header-supplied keys had no length bound (the JSON body was capped at 128
 *    by zod). A multi-kilobyte key is rejected by Postgres' btree entry limit
 *    (~2704 bytes, SQLSTATE 54000) on the unique index, which surfaced as a 500
 *    instead of a client error.
 */
describe('POST /v1/flows/:name/run idempotency keys', () => {
  type RunRow = {
    id: string
    project_id: string
    flow_name: string
    environment: string
    version_id: string
    idempotency_key: string | null
    status: string
  }

  let runs: Map<string, RunRow>
  let deployments: Map<string, { project_id: string; flow_name: string; environment: string; version_id: string }>
  let queryLog: Array<{ sql: string; params: any[] }>
  let mockPool: any
  let originalPool: any
  let app: ReturnType<typeof buildServer>

  const indexWouldConflict = (row: RunRow): boolean => {
    // Models flowscript_runs_idempotency_scope_idx:
    // UNIQUE(project_id, flow_name, environment, idempotency_key) WHERE key IS NOT NULL
    for (const existing of runs.values()) {
      if (
        existing.idempotency_key !== null &&
        existing.project_id === row.project_id &&
        existing.flow_name === row.flow_name &&
        existing.environment === row.environment &&
        existing.idempotency_key === row.idempotency_key
      ) {
        return true
      }
    }
    return false
  }

  beforeEach(() => {
    runs = new Map()
    deployments = new Map()
    queryLog = []
    originalPool = getStorePool()
    app = buildServer()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()
      queryLog.push({ sql: trimmed, params })

      if (trimmed.startsWith('SELECT v.id, v.ir, d.flow_name, d.environment')) {
        const [projectId, flowName, environment] = params
        const dep = deployments.get(`${projectId}:${flowName}:${environment}`)
        if (!dep) return { rows: [], rowCount: 0 }
        return {
          rows: [{
            id: dep.version_id,
            ir: { irVersion: 1, name: flowName, version: 1, trigger: { kind: 'manual' }, inputSchema: {}, steps: [] },
            flow_name: dep.flow_name,
            environment: dep.environment,
          }],
          rowCount: 1,
        }
      }

      if (trimmed.startsWith('SELECT id, status FROM flowscript_runs') && trimmed.includes('idempotency_key=$4')) {
        const [projectId, flowName, environment, key] = params
        for (const row of runs.values()) {
          if (
            row.project_id === projectId &&
            row.flow_name === flowName &&
            row.environment === environment &&
            row.idempotency_key === key
          ) {
            return { rows: [{ id: row.id, status: row.status }], rowCount: 1 }
          }
        }
        return { rows: [], rowCount: 0 }
      }

      if (trimmed.startsWith('INSERT INTO flowscript_runs')) {
        const [id, projectId, flowName, environment, versionId, , , idempotencyKey] = params
        const row: RunRow = {
          id,
          project_id: projectId,
          flow_name: flowName,
          environment,
          version_id: versionId,
          idempotency_key: idempotencyKey ?? null,
          status: 'queued',
        }
        if (row.idempotency_key !== null && indexWouldConflict(row)) {
          const conflict = new Error('duplicate key value violates unique constraint "flowscript_runs_idempotency_scope_idx"')
          ;(conflict as any).code = '23505'
          throw conflict
        }
        runs.set(id, row)
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

    for (const [flowName, environment] of [['flow-a', 'production'], ['flow-b', 'production'], ['flow-a', 'staging']] as const) {
      deployments.set(`proj_idem:${flowName}:${environment}`, {
        project_id: 'proj_idem',
        flow_name: flowName,
        environment,
        version_id: `version-${flowName}-${environment}`,
      })
    }
  })

  afterEach(async () => {
    setStorePool(originalPool)
    await app.close()
  })

  const runRequest = (flowName: string, headers: Record<string, string>, payload: Record<string, unknown> = {}) => {
    const projectId = 'proj_idem'
    return app.inject({
      method: 'POST',
      url: `/v1/flows/${flowName}/run`,
      headers: {
        'x-project-id': projectId,
        'x-project-signature': signProjectId(projectId),
        ...headers,
      },
      payload,
    })
  }

  it('replays the same run for a repeated key on the same flow and environment', async () => {
    const first = await runRequest('flow-a', { 'x-idempotency-key': 'req-1' })
    expect(first.statusCode).toBe(202)
    const firstRunId = first.json().runId

    const replay = await runRequest('flow-a', { 'x-idempotency-key': 'req-1' })
    expect(replay.statusCode).toBe(200)
    expect(replay.headers['x-idempotent-replay']).toBe('true')
    expect(replay.json().runId).toBe(firstRunId)
    expect(runs.size).toBe(1)
  })

  it('creates a separate run when the same key is used for a different flow', async () => {
    const flowA = await runRequest('flow-a', { 'x-idempotency-key': 'shared-key' })
    expect(flowA.statusCode).toBe(202)

    const flowB = await runRequest('flow-b', { 'x-idempotency-key': 'shared-key' })

    // Before the fix this returned 200 'duplicate' carrying flow A's runId and
    // never queued anything for flow B.
    expect(flowB.statusCode).toBe(202)
    expect(flowB.json().status).toBe('queued')
    expect(flowB.json().runId).not.toBe(flowA.json().runId)
    expect(flowB.json().flow).toBe('flow-b')
    expect(runs.size).toBe(2)

    const queuedFlows = Array.from(runs.values()).map(r => r.flow_name).sort()
    expect(queuedFlows).toEqual(['flow-a', 'flow-b'])
  })

  it('creates a separate run when the same key is used for a different environment', async () => {
    const production = await runRequest('flow-a', { 'x-idempotency-key': 'env-key' })
    expect(production.statusCode).toBe(202)

    const staging = await runRequest('flow-a', { 'x-idempotency-key': 'env-key' }, { environment: 'staging' })
    expect(staging.statusCode).toBe(202)
    expect(staging.json().runId).not.toBe(production.json().runId)
    expect(runs.size).toBe(2)
  })

  it('rejects an over-long idempotency key from the header with 400 instead of failing in the database', async () => {
    const oversized = 'k'.repeat(4096)
    const response = await runRequest('flow-a', { 'x-idempotency-key': oversized })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('INVALID_IDEMPOTENCY_KEY')
    expect(response.json().error).toContain(String(MAX_IDEMPOTENCY_KEY_LENGTH))
    // Nothing reached the runs table and no key was inserted into the index.
    expect(runs.size).toBe(0)
    expect(queryLog.some(q => q.sql.startsWith('INSERT INTO flowscript_runs'))).toBe(false)
  })

  it('accepts a key at exactly the maximum length', async () => {
    const atLimit = 'k'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH)
    const response = await runRequest('flow-a', { 'x-idempotency-key': atLimit })

    expect(response.statusCode).toBe(202)
    expect(runs.size).toBe(1)
  })

  it('rejects an over-long idempotency key in the request body', async () => {
    const response = await runRequest('flow-a', {}, { idempotencyKey: 'k'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1) })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('BAD_REQUEST')
    expect(runs.size).toBe(0)
  })

  it('normalizes surrounding whitespace so padded and unpadded keys dedupe together', async () => {
    const first = await runRequest('flow-a', { 'x-idempotency-key': 'padded-key' })
    expect(first.statusCode).toBe(202)

    const padded = await runRequest('flow-a', { 'x-idempotency-key': '  padded-key  ' })
    expect(padded.statusCode).toBe(200)
    expect(padded.json().runId).toBe(first.json().runId)
    expect(runs.size).toBe(1)
  })

  it('refuses an over-long key at the store boundary without issuing any query', async () => {
    queryLog = []
    await expect(createRun({
      projectId: 'proj_idem',
      flowName: 'flow-a',
      environment: 'production',
      versionId: 'version-flow-a-production',
      input: {},
      triggerKind: 'manual',
      idempotencyKey: 'k'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1),
    })).rejects.toThrow(/maximum length/)

    expect(queryLog).toHaveLength(0)
    expect(runs.size).toBe(0)
  })
})
