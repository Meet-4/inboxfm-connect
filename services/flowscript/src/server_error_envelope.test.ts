import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildServer, signProjectId } from './server.js'
import { setStorePool } from './store.js'

const headers = { 'x-project-id': 'proj_errors', 'x-project-signature': signProjectId('proj_errors') }

/**
 * Store calls surface raw driver errors. Those messages carry resolved DB hosts/ports, role
 * names, schema and constraint identifiers, so they must not be echoed to API clients.
 */
describe('500 responses do not leak internal error detail', () => {
  it('returns a generic body while logging the underlying error', async () => {
    const internalMessage =
      'connect ECONNREFUSED 10.4.5.6:5432 for user flowscript_app on database flowscript_prod: relation "flowscript_runs" does not exist'
    const fakePool = {
      query: async () => {
        throw new Error(internalMessage)
      },
    }
    setStorePool(fakePool as unknown as Parameters<typeof setStorePool>[0])
    try {
      const app = buildServer()
      const res = await app.inject({ method: 'GET', url: `/v1/runs/${randomUUID()}`, headers })

      expect(res.statusCode).toBe(500)
      const body = res.json()
      expect(body.code).toBe('INTERNAL_SERVER_ERROR')
      expect(body.message).toBe('Internal server error')
      expect(body.error).toBe('Internal server error')
      expect(body.requestId).toBeDefined()
      expect(res.body).not.toContain('10.4.5.6')
      expect(res.body).not.toContain('flowscript_app')
      expect(res.body).not.toContain('flowscript_runs')
      expect(res.body).not.toContain('ECONNREFUSED')
    } finally {
      setStorePool(null)
    }
  })

  it('keeps client-actionable 4xx messages', async () => {
    const app = buildServer()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/source/compile',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{"source": ',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_REQUEST')
    expect(typeof res.json().message).toBe('string')
  })
})
