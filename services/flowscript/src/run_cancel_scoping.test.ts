import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer, signProjectId } from './server.js'
import { cancelRun, getStorePool, setStorePool } from './store.js'

type RunRow = {
  id: string
  project_id: string
  flow_name: string
  status: string
  cancellation_reason?: string | null
  finished_at?: Date | null
}

/**
 * Cancellation is addressed as POST /v1/flows/:name/runs/:id/cancel, but the
 * run lookup used to ignore :name: a caller scoped to flow "support" could
 * cancel (or observe the state of) any run in its project, including runs of
 * "billing". These tests pin the flow dimension of that lookup.
 */
describe('FlowScript cancellation is scoped to the flow named in the route', () => {
  let runs: Map<string, RunRow>
  let originalPool: any
  let app: ReturnType<typeof buildServer>

  const billingRunId = '00000000-0000-4000-8000-000000000001'
  const projectId = 'proj_cancel_scope'
  const otherProjectId = 'proj_cancel_scope_other'

  const authHeaders = (project: string) => ({
    'x-project-id': project,
    'x-project-signature': signProjectId(project),
  })

  beforeEach(() => {
    runs = new Map()
    runs.set(billingRunId, {
      id: billingRunId,
      project_id: projectId,
      flow_name: 'billing',
      status: 'queued',
      cancellation_reason: null,
      finished_at: null,
    })
    originalPool = getStorePool()
    app = buildServer()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
      }

      if (normalized.startsWith('SELECT id, status FROM flowscript_runs WHERE project_id=$1 AND id=$2')) {
        const [project, id, flowName] = params
        const run = runs.get(id)
        if (!run || run.project_id !== project) return { rows: [], rowCount: 0 }
        if (typeof flowName === 'string' && run.flow_name !== flowName) return { rows: [], rowCount: 0 }
        return { rows: [{ id: run.id, status: run.status }], rowCount: 1 }
      }

      if (normalized.includes("UPDATE flowscript_runs SET status='cancelled'")) {
        const [id, reason] = params
        const run = runs.get(id)
        if (run) {
          run.status = 'cancelled'
          run.cancellation_reason = reason
          if (normalized.includes('finished_at=now()')) run.finished_at = new Date()
        }
        return { rows: [], rowCount: 1 }
      }

      return { rows: [], rowCount: 0 }
    }

    setStorePool({
      query: (sql: string, params?: any[]) => executeQuery(sql, params),
      connect: async () => ({
        query: (sql: string, params?: any[]) => executeQuery(sql, params),
        release: () => {},
      }),
      end: async () => {},
    } as any)
  })

  afterEach(async () => {
    setStorePool(originalPool)
    await app.close()
  })

  it('cancels a run of the named flow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/flows/billing/runs/${billingRunId}/cancel`,
      headers: authHeaders(projectId),
      payload: { reason: 'customer requested' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ id: billingRunId, status: 'cancelled' })
    expect(runs.get(billingRunId)?.status).toBe('cancelled')
    expect(runs.get(billingRunId)?.cancellation_reason).toBe('customer requested')
  })

  it('returns 404 and leaves the run untouched when :name does not own the run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/flows/support/runs/${billingRunId}/cancel`,
      headers: authHeaders(projectId),
      payload: { reason: 'cross-flow attempt' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('RUN_NOT_FOUND')
    expect(runs.get(billingRunId)?.status).toBe('queued')
    expect(runs.get(billingRunId)?.cancellation_reason).toBeNull()
  })

  it('still rejects runs from another project', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/flows/billing/runs/${billingRunId}/cancel`,
      headers: authHeaders(otherProjectId),
    })

    expect(res.statusCode).toBe(404)
    expect(runs.get(billingRunId)?.status).toBe('queued')
  })

  it('keeps the flow-less cancel route working for existing clients', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/runs/${billingRunId}/cancel`,
      headers: authHeaders(projectId),
    })

    expect(res.statusCode).toBe(200)
    expect(runs.get(billingRunId)?.status).toBe('cancelled')
  })

  it('passes the flow filter through to the store lookup', async () => {
    await expect(cancelRun(projectId, billingRunId, 'store-level', 'support')).resolves.toBeNull()
    expect(runs.get(billingRunId)?.status).toBe('queued')

    await expect(cancelRun(projectId, billingRunId, 'store-level', 'billing')).resolves.toEqual({ id: billingRunId, status: 'cancelled' })
    expect(runs.get(billingRunId)?.status).toBe('cancelled')
  })
})
