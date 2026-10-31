import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getStorePool, initializeStore, setStorePool } from './store.js'

/**
 * Every webhook delivery — POST /v1/hooks/:token, the service's unauthenticated
 * internet-facing ingress — resolves the trigger by
 * `WHERE kind='webhook' AND enabled=true AND secret_hash=$1`. That lookup had no
 * supporting index: EXPLAIN ANALYZE on a seeded 2200-row triggers table showed
 * `Seq Scan on flowscript_triggers ... Rows Removed by Filter: 2200` per delivery,
 * degrading linearly with the tenant count. These tests pin the DDL contract
 * that makes the lookup index-backed.
 */
describe('FlowScript store DDL creates an index for webhook secret lookups', () => {
  let capturedSql: string[]
  let mockPool: any
  let originalPool: any

  beforeEach(() => {
    capturedSql = []
    originalPool = getStorePool()
    mockPool = {
      query: async (sql: string) => {
        capturedSql.push(sql)
        return { rows: [], rowCount: 0 }
      },
      connect: async () => ({
        query: async (sql: string) => {
          capturedSql.push(sql)
          return { rows: [], rowCount: 0 }
        },
        release: () => {},
      }),
      end: async () => {},
    }
    setStorePool(mockPool)
  })

  afterEach(() => {
    setStorePool(originalPool)
  })

  it('initializeStore creates a partial index on secret_hash for webhook triggers', async () => {
    await initializeStore()

    const ddl = capturedSql.join('\n')
    expect(ddl).toContain(
      'CREATE INDEX IF NOT EXISTS flowscript_triggers_secret_idx ON flowscript_triggers(secret_hash) WHERE kind=\'webhook\'',
    )
  })

  it('the index is partial so it does not slow down schedule-trigger writes', async () => {
    await initializeStore()

    const ddl = capturedSql.join('\n')
    expect(ddl).toContain("WHERE kind='webhook'")
    // the due-triggers poll index stays untouched
    expect(ddl).toContain(
      'CREATE INDEX IF NOT EXISTS flowscript_triggers_due_idx ON flowscript_triggers(kind, next_fire_at) WHERE enabled=true',
    )
  })
})
