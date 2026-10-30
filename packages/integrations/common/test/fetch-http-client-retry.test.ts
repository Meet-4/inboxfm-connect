import { describe, expect, it } from 'vitest'
import { HttpMethod } from '../src/lib/http/core/http-method'
import { FetchHttpClient } from '../src/lib/http/core/fetch-http-client'

// Each ReadableStream records whether the consumer cancelled it. A cancelled
// stream is undici's cue to release the connection back to the pool; an
// abandoned (never-cancelled) stream keeps the socket pinned.
function makeInstrumentedStream(onCancel: () => void): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('boom'))
      // deliberately never close: simulates a body nobody reads to the end
    },
    cancel() {
      onCancel()
    },
  })
}

function stubFetchSequence(stubs: Array<() => Response>): () => void {
  const originalFetch = globalThis.fetch
  let call = 0
  globalThis.fetch = (async () => {
    const stub = stubs[Math.min(call++, stubs.length - 1)]
    return stub()
  }) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

describe('FetchHttpClient retry resource cleanup', () => {
  it('cancels the response body of an attempt it retries away from', async () => {
    let cancelledCount = 0
    const restore = stubFetchSequence([
      () => new Response(makeInstrumentedStream(() => cancelledCount++), { status: 500 }),
      () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ])

    try {
      const response = await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/retry',
        retries: 1,
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ ok: true })
      // The abandoned 500 body must be cancelled so the connection is released.
      expect(cancelledCount).toBe(1)
    } finally {
      restore()
    }
  })

  it('does not cancel the final response body (it is read, not abandoned)', async () => {
    let cancelledCount = 0
    const restore = stubFetchSequence([
      () => new Response(makeInstrumentedStream(() => cancelledCount++), { status: 500 }),
      () => new Response(makeInstrumentedStream(() => cancelledCount++), { status: 500 }),
      () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ])

    try {
      const response = await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/retry-exhausted',
        retries: 2,
      })

      expect(response.status).toBe(200)
      // Only the two abandoned attempts are cancelled; the final one is parsed.
      expect(cancelledCount).toBe(2)
    } finally {
      restore()
    }
  })
})
