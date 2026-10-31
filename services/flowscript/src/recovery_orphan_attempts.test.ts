import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getStorePool, recoverStaleRuns, setStorePool } from './store.js'

/**
 * Dead-letter lifecycle: when a worker dies mid-step, its lease expires and
 * recoverStaleRuns requeues / dead-letters / marks the run uncertain — but the
 * step attempt rows the worker opened stay status='running' with finished_at
 * NULL forever. Nothing ever finalizes them, so the per-run audit trail
 * (GET /v1/runs/:id/attempts) keeps showing in-flight work on runs that are
 * terminal, and every crashed attempt leaks a permanently-'running' row.
 * Verified against real Postgres before the fix:
 * a requeued run and a dead-lettered run both kept status='running' attempt rows.
 */
describe('FlowScript stale-run recovery finalizes orphaned step attempts', () => {
  let runs: Map<string, any>
  let stepAttempts: Map<string, any>
  let mockPool: any
  let originalPool: any

  beforeEach(() => {
    runs = new Map()
    stepAttempts = new Map()
    originalPool = getStorePool()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()

      if (normalized.includes("FROM flowscript_runs WHERE status='running' AND lease_expires_at < now()")) {
        const now = new Date()
        const expired = Array.from(runs.values())
          .filter(r => r.status === 'running' && r.lease_expires_at && new Date(r.lease_expires_at) < now)
        return {
          rows: expired.map(r => ({
            id: r.id,
            project_id: r.project_id,
            attempt_count: r.attempt_count,
            max_attempts: r.max_attempts,
            had_non_idempotent_step: r.had_non_idempotent_step,
          })),
          rowCount: expired.length,
        }
      }

      // The fix under test: finalize in-flight attempt rows for the recovered run
      if (normalized.startsWith('UPDATE flowscript_step_attempts')
        && normalized.includes("WHERE run_id=$1 AND status='running'")) {
        const [runId] = params
        let finalized = 0
        for (const attempt of stepAttempts.values()) {
          if (attempt.run_id === runId && attempt.status === 'running') {
            attempt.status = 'failed'
            attempt.error_code = 'WORKER_LEASE_EXPIRED'
            attempt.error_message = String(normalized.match(/error_message='([^']*)'/)?.[1] ?? '')
            attempt.retryable = false
            attempt.finished_at = new Date()
            finalized++
          }
        }
        return { rows: [], rowCount: finalized }
      }

      if (normalized.includes("SET status='uncertain'")) {
        const [id] = params
        const r = runs.get(id)
        if (r) { r.status = 'uncertain'; r.finished_at = new Date() }
        return { rows: [], rowCount: 1 }
      }

      if (normalized.includes("SET status='queued', retry_at=$2")) {
        const [id, retryAt] = params
        const r = runs.get(id)
        if (r) {
          r.status = 'queued'
          r.retry_at = retryAt
          r.worker_id = null
          r.lease_expires_at = null
        }
        return { rows: [], rowCount: 1 }
      }

      if (normalized.includes("SET status='dead_letter'")) {
        const [id] = params
        const r = runs.get(id)
        if (r) { r.status = 'dead_letter'; r.finished_at = new Date() }
        return { rows: [], rowCount: 1 }
      }

      if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
        return { rows: [], rowCount: 0 }
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

  afterEach(() => {
    setStorePool(originalPool)
  })

  const seedExpiredRun = (over: { attempts: number; maxAttempts: number; nonIdempotent?: boolean }): string => {
    const id = randomUUID()
    runs.set(id, {
      id,
      project_id: 'p1',
      status: 'running',
      attempt_count: over.attempts,
      max_attempts: over.maxAttempts,
      had_non_idempotent_step: over.nonIdempotent ?? false,
      worker_id: 'dead-worker',
      lease_expires_at: new Date(Date.now() - 60_000),
    })
    return id
  }

  const seedRunningAttempt = (runId: string, stepId: string, attempt: number): string => {
    const id = randomUUID()
    stepAttempts.set(id, {
      id,
      run_id: runId,
      step_id: stepId,
      attempt,
      status: 'running',
      error_code: null,
      error_message: null,
      retryable: null,
      duration_ms: null,
      started_at: new Date(),
      finished_at: null,
    })
    return id
  }

  it('finalizes the in-flight step attempt when the run is requeued for retry', async () => {
    const runId = seedExpiredRun({ attempts: 1, maxAttempts: 3 })
    const attemptId = seedRunningAttempt(runId, 'stepOne', 1)

    const result = await recoverStaleRuns()

    expect(result.retried).toContain(runId)
    const attempt = stepAttempts.get(attemptId)
    expect(attempt.status).toBe('failed')
    expect(attempt.error_code).toBe('WORKER_LEASE_EXPIRED')
    expect(attempt.retryable).toBe(false)
    expect(attempt.finished_at).not.toBeNull()
  })

  it('finalizes the in-flight step attempt when the run is dead-lettered', async () => {
    const runId = seedExpiredRun({ attempts: 3, maxAttempts: 3 })
    const attemptId = seedRunningAttempt(runId, 'stepLast', 3)

    const result = await recoverStaleRuns()

    expect(result.deadLettered).toContain(runId)
    const attempt = stepAttempts.get(attemptId)
    expect(attempt.status).toBe('failed')
    expect(attempt.error_code).toBe('WORKER_LEASE_EXPIRED')
    expect(attempt.finished_at).not.toBeNull()
  })

  it('finalizes the in-flight step attempt when the run is marked uncertain', async () => {
    const runId = seedExpiredRun({ attempts: 2, maxAttempts: 3, nonIdempotent: true })
    const attemptId = seedRunningAttempt(runId, 'sideEffect', 2)

    const result = await recoverStaleRuns()

    expect(result.uncertain).toContain(runId)
    const attempt = stepAttempts.get(attemptId)
    expect(attempt.status).toBe('failed')
    expect(attempt.error_code).toBe('WORKER_LEASE_EXPIRED')
    expect(attempt.finished_at).not.toBeNull()
  })

  it('leaves finished attempt rows untouched', async () => {
    const runId = seedExpiredRun({ attempts: 1, maxAttempts: 3 })
    const attemptId = seedRunningAttempt(runId, 'stepDone', 1)
    const finished = stepAttempts.get(attemptId)!
    finished.status = 'succeeded'
    finished.finished_at = new Date()

    await recoverStaleRuns()

    const attempt = stepAttempts.get(attemptId)
    expect(attempt.status).toBe('succeeded')
    expect(attempt.error_code).toBeNull()
  })

  it('finalizes every in-flight attempt of a multi-step crashed run', async () => {
    const runId = seedExpiredRun({ attempts: 3, maxAttempts: 3 })
    const first = seedRunningAttempt(runId, 'stepA', 3)
    const second = seedRunningAttempt(runId, 'stepB', 3)

    await recoverStaleRuns()

    for (const id of [first, second]) {
      expect(stepAttempts.get(id)!.status).toBe('failed')
      expect(stepAttempts.get(id)!.error_code).toBe('WORKER_LEASE_EXPIRED')
    }
  })
})
