import { createServer as createHttpServer, IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http'
import { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { HttpMethod } from '../src/lib/http/core/http-method'
import { FetchHttpClient } from '../src/lib/http/core/fetch-http-client'

// A sendRequest() promise that is still pending after `ms` means the client
// never enforced its own deadline — the request hangs.
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<'settled' | 'hung'> {
  return Promise.race([
    promise.then(
      () => 'settled' as const,
      () => 'settled' as const // rejection still counts as "did not hang"
    ),
    new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), ms)),
  ])
}

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function close(server: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })
}

describe('FetchHttpClient timeout enforcement on body reads', () => {
  it('rejects within the request timeout when the response body stalls (real server)', async () => {
    const server = createHttpServer((_req: IncomingMessage, res: ServerResponse) => {
      // Headers arrive promptly, the body never completes.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"ok":')
      // deliberately never calls res.end()
    })
    const port = await listen(server)

    try {
      const outcome = await settlesWithin(
        new FetchHttpClient().sendRequest({
          method: HttpMethod.GET,
          url: `http://127.0.0.1:${port}/slow-body`,
          timeout: 400,
        }),
        2500
      )

      expect(outcome).toBe('settled')
    } finally {
      await close(server)
    }
  })

  it('rejects within the request timeout when the error-response body stalls (real server)', async () => {
    const server = createHttpServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.write('{"error":')
      // deliberately never calls res.end()
    })
    const port = await listen(server)

    try {
      const outcome = await settlesWithin(
        new FetchHttpClient().sendRequest({
          method: HttpMethod.GET,
          url: `http://127.0.0.1:${port}/slow-error-body`,
          timeout: 400,
        }),
        2500
      )

      expect(outcome).toBe('settled')
    } finally {
      await close(server)
    }
  })

  it('aborts a body read that stalls even when the stream ignores the fetch signal', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => ({
      status: 200,
      headers: new Headers(),
      text: () => new Promise<string>(() => {
        // never settles — simulates a stalled body not tied to the abort signal
      }),
    })) as typeof fetch

    try {
      const outcome = await settlesWithin(
        new FetchHttpClient().sendRequest({
          method: HttpMethod.GET,
          url: 'http://127.0.0.1:9/stalled',
          timeout: 150,
        }),
        2000
      )

      expect(outcome).toBe('settled')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('still returns promptly-read bodies untouched', async () => {
    const server = createHttpServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
    })
    const port = await listen(server)

    try {
      const response = await new FetchHttpClient().sendRequest<{ ok: boolean }>({
        method: HttpMethod.GET,
        url: `http://127.0.0.1:${port}/ok`,
        timeout: 5000,
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true })
    } finally {
      await close(server)
    }
  })
})
