import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getStorePool, listRuns, setStorePool } from './store.js'
import { buildServer, signProjectId } from './server.js'

/**
 * Dead-letter operator visibility. EXECUTION.md designates dead_letter and
 * uncertain runs for operator triage, but GET /v1/runs had no status filter:
 * a project emitting thousands of runs per day buries its dead-lettered runs
 * under newest-first pages of 50, and there is no other way to find them
 * short of SQL. listRuns (the store function behind the route) had no status
 * parameter at all.
 */
describe('FlowScript run listing status filter (dead-letter operator visibility)', () => {
  let runs: Array<any>
  let captured: Array<{ sql: string; params: any[] }>
  let mockPool: any
  let originalPool: any
  let app: ReturnType<typeof buildServer>

  const seed = (status: string, flowName: string, ageMinutes: number) => ({
    id: randomUUID(),
    project_id: 'proj_dlq',
    flow_name: flowName,
    environment: 'production',
    version_id: randomUUID(),
    trigger_kind: 'webhook',
    status,
    error: null,
    worker_id: null,
    attempt_count: 1,
    retry_at: null,
    cancellation_reason: null,
    started_at: null,
    finished_at: null,
    created_at: new Date(Date.now() - ageMinutes * 60_000),
  })

  beforeEach(() => {
    runs = [
      seed('succeeded', 'orders', 1),
      seed('dead_letter', 'orders', 5),
      seed('dead_letter', 'payments', 10),
      seed('uncertain', 'payments', 15),
      seed('queued', 'orders', 2),
    ]
    captured = []
    originalPool = getStorePool()
    app = buildServer()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      captured.push({ sql: normalized, params })

      if (normalized.includes('FROM flowscript_runs WHERE project_id=$1')
        && normalized.includes('ORDER BY created_at DESC')) {
        const [projectId, flowName, status, limit] = params
        const matching = runs
          .filter(r => r.project_id === projectId)
          .filter(r => flowName === null || r.flow_name === flowName)
          .filter(r => status === null || r.status === status)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, limit)
        return { rows: matching, rowCount: matching.length }
      }

      return { rows: [], rowCount: 0 }
    }

    mockPool = {
      query: (sql: string, params?: any[]) => executeQuery(sql, params),
      connect: async () => ({
        query: (sql: string, params?: any[]) => executeQuery(sql, params),
        release: () => {},
      }),
      end: async () => {},
    }

    setStorePool(mockPool)
  })

  afterEach(async () => {
    setStorePool(originalPool)
    await app.close()
  })

  it('listRuns filters by status', async () => {
    const deadLettered = await listRuns('proj_dlq', undefined, 50, 'dead_letter')

    expect(deadLettered).toHaveLength(2)
    expect(deadLettered.every(r => r.status === 'dead_letter')).toBe(true)
    const lastQuery = captured[captured.length - 1]
    expect(lastQuery.sql).toContain('($3::text IS NULL OR status=$3)')
  })

  it('listRuns without a status returns every status (backwards compatible)', async () => {
    const all = await listRuns('proj_dlq', undefined, 50)

    expect(all).toHaveLength(5)
    expect(new Set(all.map(r => r.status))).toEqual(new Set(['succeeded', 'dead_letter', 'uncertain', 'queued']))
  })

  it('status combines with the flow filter', async () => {
    const payments = await listRuns('proj_dlq', 'payments', 50, 'dead_letter')

    expect(payments).toHaveLength(1)
    expect(payments[0].flowName).toBe('payments')
  })

  it('GET /v1/runs?status=dead_letter returns only dead-lettered runs for the project', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs?status=dead_letter',
      headers: { 'x-project-id': 'proj_dlq', 'x-project-signature': signProjectId('proj_dlq') },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.runs).toHaveLength(2)
    expect(body.runs.every((r: any) => r.status === 'dead_letter')).toBe(true)
  })

  it('GET /v1/runs rejects an unknown status with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs?status=finished',
      headers: { 'x-project-id': 'proj_dlq', 'x-project-signature': signProjectId('proj_dlq') },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().code).toBe('BAD_REQUEST')
  })

  it('GET /v1/runs without status lists all runs (backwards compatible)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/runs',
      headers: { 'x-project-id': 'proj_dlq', 'x-project-signature': signProjectId('proj_dlq') },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().runs).toHaveLength(5)
  })
})
