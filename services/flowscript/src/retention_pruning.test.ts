import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  getStorePool,
  pruneExpiredFlowscriptData,
  setStorePool,
} from './store.js'

/**
 * Retention sweep for the flowscript tables.
 *
 * Nothing in the service ever deleted old runs, step attempts, webhook idempotency
 * rows or schedule occurrences: a 1-minute cron trigger alone accumulates ~525k
 * occurrence rows per year, every webhook delivery with an idempotency key leaves a
 * permanent ledger row, and every finished run keeps its input/output/steps jsonb
 * blobs forever. These tests pin the bounded sweep that drains them.
 */
describe('FlowScript retention sweep (bounded pruning of old runs and trigger ledgers)', () => {
  let runs: Map<string, any>
  let webhookIdempotency: Map<string, any>
  let occurrences: Map<string, any>
  let issuedQueries: Array<{ sql: string; params: any[] }>
  let mockPool: any
  let originalPool: any
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const TERMINAL_PRUNE_STATUSES = new Set(['succeeded', 'failed', 'cancelled'])
  const DEAD_LETTER_PRUNE_STATUSES = new Set(['dead_letter', 'uncertain'])

  const seedRun = (status: string, ageDays: number): string => {
    const id = randomUUID()
    runs.set(id, { id, status, created_at: daysAgo(ageDays) })
    return id
  }

  beforeEach(() => {
    runs = new Map()
    webhookIdempotency = new Map()
    occurrences = new Map()
    issuedQueries = []
    originalPool = getStorePool()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      issuedQueries.push({ sql: normalized, params })

      if (normalized.startsWith('DELETE FROM flowscript_runs')) {
        const [retentionDays, batchLimit] = params
        const statuses = normalized.includes("'dead_letter','uncertain'")
          ? DEAD_LETTER_PRUNE_STATUSES
          : TERMINAL_PRUNE_STATUSES
        const cutoff = daysAgo(retentionDays)
        const victims = Array.from(runs.values())
          .filter(r => statuses.has(r.status) && new Date(r.created_at) < cutoff)
          .slice(0, batchLimit)
        for (const victim of victims) {
          runs.delete(victim.id)
          // model ON DELETE CASCADE from flowscript_runs
          for (const [idemId, idem] of webhookIdempotency.entries()) {
            if (idem.run_id === victim.id) webhookIdempotency.delete(idemId)
          }
          for (const [occId, occ] of occurrences.entries()) {
            if (occ.run_id === victim.id) occurrences.delete(occId)
          }
        }
        return { rows: [], rowCount: victims.length }
      }

      if (normalized.startsWith('DELETE FROM flowscript_webhook_idempotency')) {
        const [retentionDays, batchLimit] = params
        const cutoff = daysAgo(retentionDays)
        const victims = Array.from(webhookIdempotency.entries())
          .filter(([, idem]) => new Date(idem.created_at) < cutoff)
          .slice(0, batchLimit)
        for (const [id] of victims) webhookIdempotency.delete(id)
        return { rows: [], rowCount: victims.length }
      }

      if (normalized.startsWith('DELETE FROM flowscript_schedule_occurrences')) {
        const [retentionDays, batchLimit] = params
        const cutoff = daysAgo(retentionDays)
        const victims = Array.from(occurrences.entries())
          .filter(([, occ]) => new Date(occ.scheduled_instant) < cutoff)
          .slice(0, batchLimit)
        for (const [id] of victims) occurrences.delete(id)
        return { rows: [], rowCount: victims.length }
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
    delete process.env.FLOWSCRIPT_RETENTION_DAYS
    delete process.env.FLOWSCRIPT_DEAD_LETTER_RETENTION_DAYS
    delete process.env.FLOWSCRIPT_RETENTION_BATCH_SIZE
  })

  it('deletes terminal runs past the horizon, keeps recent runs, queued/running runs and younger dead letters', async () => {
    const oldSucceeded = seedRun('succeeded', 40)
    const newSucceeded = seedRun('succeeded', 5)
    const oldQueued = seedRun('queued', 40)
    const oldRunning = seedRun('running', 40)
    const youngDeadLetter = seedRun('dead_letter', 40)

    const result = await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 90 })

    expect(result.runsDeleted).toBe(1)
    expect(result.deadLetterRunsDeleted).toBe(0)
    expect(runs.has(oldSucceeded)).toBe(false)
    expect(runs.has(newSucceeded)).toBe(true)
    expect(runs.has(oldQueued)).toBe(true)
    expect(runs.has(oldRunning)).toBe(true)
    // dead_letter is held for the longer operator-triage horizon (40d < 90d)
    expect(runs.has(youngDeadLetter)).toBe(true)
  })

  it('prunes dead-letter and uncertain runs only after the longer dead-letter horizon', async () => {
    const oldDeadLetter = seedRun('dead_letter', 50)
    const oldUncertain = seedRun('uncertain', 50)
    const youngDeadLetter = seedRun('dead_letter', 20)

    const result = await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 40 })

    expect(result.deadLetterRunsDeleted).toBe(2)
    expect(result.runsDeleted).toBe(0)
    expect(runs.has(oldDeadLetter)).toBe(false)
    expect(runs.has(oldUncertain)).toBe(false)
    expect(runs.has(youngDeadLetter)).toBe(true)
  })

  it('cascades run deletion to the webhook idempotency and occurrence rows referencing it', async () => {
    const oldRun = seedRun('succeeded', 40)
    webhookIdempotency.set('idem-1', { id: 'idem-1', run_id: oldRun, created_at: daysAgo(40) })
    occurrences.set('occ-1', { id: 'occ-1', run_id: oldRun, scheduled_instant: daysAgo(40) })

    await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 90 })

    expect(webhookIdempotency.has('idem-1')).toBe(false)
    expect(occurrences.has('occ-1')).toBe(false)
  })

  it('prunes webhook idempotency and schedule occurrence ledgers past the horizon in bounded batches', async () => {
    webhookIdempotency.set('idem-old', { id: 'idem-old', run_id: null, created_at: daysAgo(35) })
    webhookIdempotency.set('idem-new', { id: 'idem-new', run_id: null, created_at: daysAgo(2) })
    occurrences.set('occ-old', { id: 'occ-old', scheduled_instant: daysAgo(35) })
    occurrences.set('occ-new', { id: 'occ-new', scheduled_instant: daysAgo(2) })

    const result = await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 90 })

    expect(result.webhookIdempotencyDeleted).toBe(1)
    expect(result.scheduleOccurrencesDeleted).toBe(1)
    expect(webhookIdempotency.has('idem-old')).toBe(false)
    expect(webhookIdempotency.has('idem-new')).toBe(true)
    expect(occurrences.has('occ-old')).toBe(false)
    expect(occurrences.has('occ-new')).toBe(true)
  })

  it('every delete statement is batch-bounded and carries its class horizon', async () => {
    seedRun('succeeded', 40)
    await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 90, batchSize: 250 })

    const deletes = issuedQueries.filter(q => q.sql.startsWith('DELETE FROM'))
    expect(deletes.length).toBe(4)
    for (const del of deletes) {
      expect(del.sql).toContain('LIMIT $2')
      expect(del.sql).toContain('WHERE id IN')
      expect(del.sql).toContain('make_interval(days => $1::int)')
      expect(del.params[0]).toBeGreaterThan(0)
      expect(del.params[1]).toBe(250)
    }
  })

  it('clamps the batch size to a safe range and falls back on invalid input', async () => {
    const huge = await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 90, batchSize: 5_000_000 })
    expect(huge.batchSize).toBe(10_000)

    const invalid = await pruneExpiredFlowscriptData({ retentionDays: 30, deadLetterRetentionDays: 90, batchSize: Number('not-a-number') })
    expect(invalid.batchSize).toBe(1000)
  })

  it('retention 0 for both classes disables the sweep without issuing any delete', async () => {
    seedRun('succeeded', 400)

    const result = await pruneExpiredFlowscriptData({ retentionDays: 0, deadLetterRetentionDays: 0 })

    expect(result.disabled).toBe(true)
    expect(issuedQueries.filter(q => q.sql.startsWith('DELETE FROM'))).toHaveLength(0)
    expect(runs.size).toBe(1)
  })

  it('honours FLOWSCRIPT_RETENTION_DAYS and FLOWSCRIPT_DEAD_LETTER_RETENTION_DAYS env defaults', async () => {
    process.env.FLOWSCRIPT_RETENTION_DAYS = '7'
    process.env.FLOWSCRIPT_DEAD_LETTER_RETENTION_DAYS = '0'
    const justOutsideSeven = seedRun('failed', 8)
    const justInsideSeven = seedRun('failed', 6)
    const oldDeadLetter = seedRun('dead_letter', 400)

    const result = await pruneExpiredFlowscriptData()

    expect(result.retentionDays).toBe(7)
    expect(result.deadLetterRetentionDays).toBe(0)
    expect(result.runsDeleted).toBe(1)
    expect(result.deadLetterRunsDeleted).toBe(0)
    expect(runs.has(justOutsideSeven)).toBe(false)
    expect(runs.has(justInsideSeven)).toBe(true)
    expect(runs.has(oldDeadLetter)).toBe(true)
  })
})
