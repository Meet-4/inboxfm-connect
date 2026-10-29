import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getStorePool, recoverStaleRuns, setStorePool } from './store.js'

/**
 * The stale-lease sweep used to select every expired run with no LIMIT, so a
 * crash of all worker replicas (which expires the entire running set at once)
 * loaded and locked thousands of rows in a single transaction and issued one
 * UPDATE round-trip per row from the sweep itself. Recovery is now a bounded
 * batch: oldest leases first, bounded work per call, remainder on the next tick.
 */
describe('recoverStaleRuns bounded batching', () => {
  type StaleRun = {
    id: string
    project_id: string
    status: string
    lease_expires_at: Date | null
    attempt_count: number
    max_attempts: number
    had_non_idempotent_step: boolean
  }

  let runs: Map<string, StaleRun>
  let limitParams: number[]
  let mockPool: any
  let originalPool: any

  beforeEach(() => {
    runs = new Map()
    limitParams = []
    originalPool = getStorePool()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim()

      if (trimmed.includes("FROM flowscript_runs WHERE status='running' AND lease_expires_at < now()")) {
        const limit = Number(params[0])
        limitParams.push(limit)
        const now = Date.now()
        const expired = Array.from(runs.values())
          .filter(r => r.status === 'running' && r.lease_expires_at !== null && r.lease_expires_at.getTime() < now)
          .sort((a, b) => (a.lease_expires_at as Date).getTime() - (b.lease_expires_at as Date).getTime())
          .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined)
          .map(r => ({
            id: r.id,
            project_id: r.project_id,
            attempt_count: r.attempt_count,
            max_attempts: r.max_attempts,
            had_non_idempotent_step: r.had_non_idempotent_step,
          }))
        return { rows: expired, rowCount: expired.length }
      }

      if (trimmed.includes("SET status='uncertain'")) {
        const [id] = params
        const run = runs.get(id)
        if (run) {
          run.status = 'uncertain'
          run.lease_expires_at = null
        }
        return { rows: [], rowCount: 1 }
      }

      if (trimmed.includes("SET status='queued', retry_at=$2")) {
        const [id] = params
        const run = runs.get(id)
        if (run) {
          run.status = 'queued'
          run.lease_expires_at = null
        }
        return { rows: [], rowCount: 1 }
      }

      if (trimmed.includes("SET status='dead_letter'")) {
        const [id] = params
        const run = runs.get(id)
        if (run) {
          run.status = 'dead_letter'
          run.lease_expires_at = null
        }
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

  const seedExpired = (count: number, overrides: Partial<StaleRun> = {}): void => {
    const base = Date.now() - 120_000
    for (let i = 0; i < count; i++) {
      const id = overrides.id ?? `run-${String(i).padStart(4, '0')}`
      runs.set(id, {
        id,
        project_id: 'proj_recovery',
        status: 'running',
        // Oldest first deterministically, so FIFO order is observable.
        lease_expires_at: new Date(base - (count - i) * 1000),
        attempt_count: 1,
        max_attempts: 3,
        had_non_idempotent_step: false,
        ...overrides,
      })
    }
  }

  it('sweeps at most 200 expired leases by default and leaves the rest for the next pass', async () => {
    seedExpired(250)

    const firstPass = await recoverStaleRuns()
    expect(limitParams[0]).toBe(200)
    expect(firstPass.recoveredCount).toBe(200)
    expect(firstPass.retried).toHaveLength(200)
    expect(Array.from(runs.values()).filter(r => r.status === 'running')).toHaveLength(50)

    const secondPass = await recoverStaleRuns()
    expect(secondPass.recoveredCount).toBe(50)
    expect(Array.from(runs.values()).filter(r => r.status === 'running')).toHaveLength(0)
    expect(Array.from(runs.values()).every(r => r.status === 'queued')).toBe(true)
  })

  it('honours an explicit batchSize and drains the backlog over repeated passes', async () => {
    seedExpired(5)

    const first = await recoverStaleRuns({ batchSize: 2 })
    expect(limitParams[0]).toBe(2)
    expect(first.recoveredCount).toBe(2)
    expect(Array.from(runs.values()).filter(r => r.status === 'running')).toHaveLength(3)

    await recoverStaleRuns({ batchSize: 2 })
    const third = await recoverStaleRuns({ batchSize: 2 })
    expect(third.recoveredCount).toBe(1)
    expect(Array.from(runs.values()).filter(r => r.status === 'running')).toHaveLength(0)
  })

  it('recovers the oldest leases first so no run starves behind newer failures', async () => {
    seedExpired(4)

    await recoverStaleRuns({ batchSize: 2 })
    const stillRunning = Array.from(runs.values()).filter(r => r.status === 'running').map(r => r.id)
    // The two newest leases remain for the next pass.
    expect(stillRunning.sort()).toEqual(['run-0002', 'run-0003'])
  })

  it('clamps the batch size to the supported range', async () => {
    seedExpired(3)

    await recoverStaleRuns({ batchSize: 0 })
    expect(limitParams[0]).toBe(1)

    await recoverStaleRuns({ batchSize: 5_000 })
    expect(limitParams[1]).toBe(1000)

    // A non-finite batch size must degrade to the default, never reach the DB as
    // LIMIT 'NaN' (which Postgres rejects, failing every sweep from then on).
    await recoverStaleRuns({ batchSize: Number.NaN })
    expect(limitParams[2]).toBe(200)
  })

  it('keeps per-run recovery decisions unchanged inside a batch', async () => {
    const now = Date.now() - 60_000
    seedExpired(1, { id: 'run-uncertain', had_non_idempotent_step: true, lease_expires_at: new Date(now) })
    seedExpired(1, { id: 'run-exhausted', attempt_count: 3, max_attempts: 3, lease_expires_at: new Date(now + 1000) })
    seedExpired(1, { id: 'run-retryable', lease_expires_at: new Date(now + 2000) })

    const result = await recoverStaleRuns({ batchSize: 10 })

    expect(result.recoveredCount).toBe(3)
    expect([...result.uncertain].sort()).toEqual(['run-uncertain'])
    expect([...result.deadLettered].sort()).toEqual(['run-exhausted'])
    expect([...result.retried].sort()).toEqual(['run-retryable'])
  })

  it('ignores runs whose lease has not expired yet', async () => {
    seedExpired(1)
    runs.set('run-fresh', {
      id: 'run-fresh',
      project_id: 'proj_recovery',
      status: 'running',
      lease_expires_at: new Date(Date.now() + 60_000),
      attempt_count: 1,
      max_attempts: 3,
      had_non_idempotent_step: false,
    })

    const result = await recoverStaleRuns()
    expect(result.recoveredCount).toBe(1)
    expect(runs.get('run-fresh')?.status).toBe('running')
  })
})
