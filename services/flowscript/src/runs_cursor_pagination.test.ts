import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  decodeRunListCursor,
  encodeRunListCursor,
  getStorePool,
  listRunsPage,
  setStorePool,
} from './store.js'
import { buildServer, signProjectId } from './server.js'

/**
 * Keyset cursor pagination for GET /v1/runs. The listing previously returned at most
 * 100 runs (limit-capped, offset-free) with no way to continue, so run history beyond
 * the first page was unreachable through the API — the API.md "Add cursor pagination
 * before run history grows significantly" follow-up.
 *
 * The route now returns a SeekPage ({ data, next, previous }, issue #718 convention)
 * and walks the (created_at, id) keyset: each `next` cursor names the last emitted
 * row, the following page starts strictly after it, and the cursor is only ever a
 * position — the project scoping of the query still decides which rows can appear.
 */
describe('FlowScript run listing cursor pagination (SeekPage on GET /v1/runs)', () => {
  let runs: Array<any>
  let captured: Array<{ sql: string; params: any[] }>
  let mockPool: any
  let originalPool: any
  let app: ReturnType<typeof buildServer>

  const headers = (project: string) => ({
    'x-project-id': project,
    'x-project-signature': signProjectId(project),
  })

  const seed = (projectId: string, flowName: string, ageMinutes: number, id?: string) => ({
    id: id ?? randomUUID(),
    project_id: projectId,
    flow_name: flowName,
    environment: 'production',
    version_id: randomUUID(),
    trigger_kind: 'webhook',
    status: 'succeeded',
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
    captured = []
    originalPool = getStorePool()
    app = buildServer()

    const executeQuery = async (sql: string, params: any[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim()
      captured.push({ sql: normalized, params })

      if (normalized.includes('FROM flowscript_runs')
        && normalized.includes('ORDER BY created_at DESC, id DESC')) {
        const [projectId, flowName, status, cursorCreatedAt, cursorId, limit] = params
        const cursorTime = cursorCreatedAt === null ? null : new Date(cursorCreatedAt).getTime()
        const matching = runs
          .filter(r => r.project_id === projectId)
          .filter(r => flowName === null || r.flow_name === flowName)
          .filter(r => status === null || r.status === status)
          // keyset predicate: strictly after the cursor position (created_at DESC, id DESC)
          .filter(r => cursorTime === null
            || new Date(r.created_at).getTime() < cursorTime
            || (new Date(r.created_at).getTime() === cursorTime && r.id < cursorId))
          .sort((a, b) => {
            const delta = new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            if (delta !== 0) return delta
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
          })
        return { rows: matching.slice(0, limit), rowCount: Math.min(matching.length, limit) }
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

  it('GET /v1/runs returns a SeekPage and no cursor when the project fits in one page', async () => {
    runs = [seed('proj_page', 'orders', 1), seed('proj_page', 'orders', 5)]

    const response = await app.inject({ method: 'GET', url: '/v1/runs', headers: headers('proj_page') })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.data).toHaveLength(2)
    expect(body.data[0].id).toBe(runs[0].id)
    expect(body.next).toBeNull()
    expect(body.previous).toBeNull()
  })

  it('caps the first page at limit and emits a cursor naming the last emitted run', async () => {
    runs = [1, 2, 3, 4, 5].map(age => seed('proj_page', 'orders', age))

    const response = await app.inject({ method: 'GET', url: '/v1/runs?limit=2', headers: headers('proj_page') })

    const body = response.json()
    expect(body.data.map((r: any) => r.id)).toEqual([runs[0].id, runs[1].id])
    expect(body.next).not.toBeNull()
    expect(decodeRunListCursor(body.next)).toEqual({
      createdAtMs: new Date(runs[1].created_at).getTime(),
      id: runs[1].id,
    })
  })

  it('walks every page via ?cursor= without repeats or skips, ending on next=null', async () => {
    runs = [1, 2, 3, 4, 5].map(age => seed('proj_page', 'orders', age))

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const url: string = cursor
        ? `/v1/runs?limit=2&cursor=${encodeURIComponent(cursor)}`
        : '/v1/runs?limit=2'
      const response = await app.inject({ method: 'GET', url, headers: headers('proj_page') })
      expect(response.statusCode).toBe(200)
      const body: { data: Array<{ id: string }>, next: string | null } = response.json()
      seen.push(...body.data.map((r: any) => r.id))
      cursor = body.next
      pages += 1
    } while (cursor && pages < 10)

    expect(pages).toBe(3)
    expect(seen).toEqual([runs[0].id, runs[1].id, runs[2].id, runs[3].id, runs[4].id])
    expect(cursor).toBeNull()
  })

  it('resolves same-timestamp ties by id so no run is skipped or repeated', async () => {
    const tieMoment = new Date(Date.now() - 60_000)
    const id1 = '00000000-0000-4000-8000-000000000001'
    const id2 = '00000000-0000-4000-8000-000000000002'
    const id3 = '00000000-0000-4000-8000-000000000003'
    const tied = (id: string) => ({ ...seed('proj_page', 'orders', 1, id), created_at: tieMoment })
    runs = [tied(id1), tied(id2), tied(id3)]

    const seen: string[] = []
    let cursor: string | null = null
    do {
      const url: string = cursor
        ? `/v1/runs?limit=1&cursor=${encodeURIComponent(cursor)}`
        : '/v1/runs?limit=1'
      const response = await app.inject({ method: 'GET', url, headers: headers('proj_page') })
      const body: { data: Array<{ id: string }>, next: string | null } = response.json()
      expect(response.statusCode).toBe(200)
      expect(body.data).toHaveLength(1)
      seen.push(body.data[0].id)
      cursor = body.next
    } while (cursor)

    // newest-first within the tie means id DESC: 3, 2, 1 — one per page, none dropped
    expect(seen).toEqual([id3, id2, id1])
  })

  it('combines the flow filter with the cursor', async () => {
    runs = [
      seed('proj_page', 'orders', 1),
      seed('proj_page', 'billing', 2),
      seed('proj_page', 'orders', 3),
      seed('proj_page', 'billing', 4),
      seed('proj_page', 'orders', 5),
    ]

    const first = await app.inject({ method: 'GET', url: '/v1/runs?flow=orders&limit=2', headers: headers('proj_page') })
    expect(first.json().data.map((r: any) => r.id)).toEqual([runs[0].id, runs[2].id])

    const second = await app.inject({
      method: 'GET',
      url: `/v1/runs?flow=orders&limit=2&cursor=${encodeURIComponent(first.json().next)}`,
      headers: headers('proj_page'),
    })
    expect(second.json().data.map((r: any) => r.id)).toEqual([runs[4].id])
    expect(second.json().next).toBeNull()
  })

  it('keeps cursors project-scoped: another project walking the same position never sees foreign runs', async () => {
    runs = [
      seed('proj_a', 'orders', 1),          // cursor position (newest of project A)
      seed('proj_a', 'orders', 6),          // older A run: makes A's first page emit a cursor
      seed('proj_b', 'orders', 0.4),        // newer than the position — must not appear for B
      seed('proj_b', 'orders', 2),
      seed('proj_b', 'orders', 3),
    ]

    const pageA = await app.inject({ method: 'GET', url: '/v1/runs?limit=1', headers: headers('proj_a') })
    expect(pageA.statusCode).toBe(200)
    expect(pageA.json().next).not.toBeNull()

    const pageB = await app.inject({
      method: 'GET',
      url: `/v1/runs?cursor=${encodeURIComponent(pageA.json().next)}`,
      headers: headers('proj_b'),
    })
    expect(pageB.statusCode).toBe(200)
    expect(pageB.json().data.map((r: any) => r.id)).toEqual([runs[3].id, runs[4].id])
  })

  it('rejects a malformed cursor with 400 and no other side effects', async () => {
    runs = [seed('proj_page', 'orders', 1)]
    const badCursors = [
      'not-a-cursor',
      Buffer.from('{}').toString('base64url'),
      Buffer.from('{"createdAtMs":"x","id":"y"}').toString('base64url'),
      Buffer.from('{"createdAtMs":123,"id":"nope"}').toString('base64url'),
    ]

    for (const bad of badCursors) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/runs?cursor=${encodeURIComponent(bad)}`,
        headers: headers('proj_page'),
      })
      expect(response.statusCode).toBe(400)
      expect(response.json().code).toBe('BAD_REQUEST')
    }
  })

  it('listRunsPage builds the keyset query, fetches limit+1 and clamps the limit', async () => {
    runs = [seed('proj_page', 'orders', 1)]

    await listRunsPage('proj_page', { flowName: 'orders', limit: 500 })

    const last = captured[captured.length - 1]
    expect(last.sql).toContain('(created_at, id) < ($4::timestamptz, $5::uuid)')
    expect(last.sql).toContain('ORDER BY created_at DESC, id DESC')
    expect(last.sql).toContain('($2::text IS NULL OR flow_name=$2)')
    expect(last.params).toEqual(['proj_page', 'orders', null, null, null, 101])
  })

  it('listRunsPage passes the decoded cursor position into the keyset predicate', async () => {
    runs = [seed('proj_page', 'orders', 1)]
    const cursor = { createdAtMs: Date.now() - 60_000, id: randomUUID() }

    await listRunsPage('proj_page', { cursor })

    const last = captured[captured.length - 1]
    expect(last.params[3]).toEqual(new Date(cursor.createdAtMs))
    expect(last.params[4]).toBe(cursor.id)
    expect(last.params[5]).toBe(51)
  })

  it('listRunsPage accepts a status filter (composes with the open status-filter route change)', async () => {
    runs = [seed('proj_page', 'orders', 1)]

    await listRunsPage('proj_page', { status: 'dead_letter' })

    const last = captured[captured.length - 1]
    expect(last.sql).toContain('($3::text IS NULL OR status=$3)')
    expect(last.params[2]).toBe('dead_letter')
  })

  it('decodeRunListCursor round-trips valid cursors and rejects malformed tokens', () => {
    const valid = { createdAtMs: Date.now(), id: randomUUID() }
    expect(decodeRunListCursor(encodeRunListCursor(valid))).toEqual(valid)
    expect(decodeRunListCursor('garbage')).toBeNull()
    expect(decodeRunListCursor(Buffer.from('[]').toString('base64url'))).toBeNull()
    expect(decodeRunListCursor(Buffer.from('{"createdAtMs":12.5,"id":"x"}').toString('base64url'))).toBeNull()
    expect(decodeRunListCursor(Buffer.from('{"createdAtMs":0,"id":"00000000-0000-4000-8000-000000000001"}').toString('base64url'))).toBeNull()
  })
})
