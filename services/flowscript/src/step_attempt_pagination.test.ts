import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildServer, signProjectId } from './server.js'
import {
  DEFAULT_STEP_ATTEMPT_PAGE_SIZE,
  MAX_STEP_ATTEMPT_PAGE_SIZE,
  getStorePool,
  listStepAttempts,
  setStorePool,
} from './store.js'

type AttemptRow = {
  id: string
  run_id: string
  step_id: string
  attempt: number
  status: string
  error_code: string | null
  error_message: string | null
  retryable: boolean | null
  duration_ms: number | null
  started_at: Date
  finished_at: Date | null
}

describe('FlowScript step-attempt listing is bounded and paginated', () => {
  let attempts: AttemptRow[]
  let lastQuery: { sql: string; params: any[] } | null
  let originalPool: any
  let app: ReturnType<typeof buildServer>

  const runId = '00000000-0000-4000-8000-0000000000aa'
  const projectId = 'proj_attempts'

  beforeEach(() => {
    lastQuery = null
    attempts = Array.from({ length: 250 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      run_id: runId,
      step_id: `step_${Math.floor(index / 10)}`,
      attempt: (index % 10) + 1,
      status: index % 3 === 0 ? 'failed' : 'succeeded',
      error_code: index % 3 === 0 ? 'PROVIDER_ERROR' : null,
      error_message: index % 3 === 0 ? 'upstream 503' : null,
      retryable: index % 3 === 0,
      duration_ms: 12,
      started_at: new Date(1_700_000_000_000 + index * 1000),
      finished_at: new Date(1_700_000_000_500 + index * 1000),
    }))
    originalPool = getStorePool()
    app = buildServer()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      if (normalized.startsWith('FROM flowscript_step_attempts') || normalized.includes('FROM flowscript_step_attempts')) {
        lastQuery = { sql: normalized, params }
        const [, limit, offset] = params
        const rows = attempts.slice(offset, offset + limit)
        return { rows, rowCount: rows.length }
      }
      if (normalized.includes('FROM flowscript_runs WHERE project_id=$1 AND id=$2')) {
        const [project, id] = params
        if (project === projectId && id === runId) {
          return { rows: [{ id: runId, flow_name: 'wide-flow', project_id: projectId }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
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

  it('returns one bounded page plus a hasMore flag instead of every row', async () => {
    const page = await listStepAttempts(runId)

    expect(page.attempts).toHaveLength(DEFAULT_STEP_ATTEMPT_PAGE_SIZE)
    expect(page.hasMore).toBe(true)
    expect(lastQuery?.sql).toContain('LIMIT $2 OFFSET $3')
    // limit + 1 rows are requested so hasMore needs no COUNT query
    expect(lastQuery?.params).toEqual([runId, DEFAULT_STEP_ATTEMPT_PAGE_SIZE + 1, 0])
  })

  it('walks the remaining pages with offset and stops reporting hasMore', async () => {
    const lastPage = await listStepAttempts(runId, { limit: 100, offset: 200 })

    expect(lastPage.attempts).toHaveLength(50)
    expect(lastPage.hasMore).toBe(false)
    expect(lastPage.attempts[0].stepId).toBe('step_20')
  })

  it('clamps oversized limits and negative offsets instead of trusting the caller', async () => {
    const page = await listStepAttempts(runId, { limit: 100_000, offset: -5 })

    expect(lastQuery?.params).toEqual([runId, MAX_STEP_ATTEMPT_PAGE_SIZE + 1, 0])
    expect(page.attempts).toHaveLength(250)
    expect(page.hasMore).toBe(false)
  })

  it('serves GET /v1/runs/:id/attempts with limit, offset and hasMore', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}/attempts?limit=10&offset=5`,
      headers: {
        'x-project-id': projectId,
        'x-project-signature': signProjectId(projectId),
      },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.runId).toBe(runId)
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(5)
    expect(body.hasMore).toBe(true)
    expect(body.attempts).toHaveLength(10)
    expect(body.attempts[0].stepId).toBe('step_0')
  })

  it('rejects pagination requests beyond the documented bounds', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/runs/${runId}/attempts?limit=5000`,
      headers: {
        'x-project-id': projectId,
        'x-project-signature': signProjectId(projectId),
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_REQUEST')
  })
})
