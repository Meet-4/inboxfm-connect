import { describe, expect, it } from 'vitest'
import { HttpMethod } from '../src/lib/http/core/http-method'
import { FetchHttpClient } from '../src/lib/http/core/fetch-http-client'
import { HttpError } from '../src/lib/http/core/http-error'

function stubFetchStatus(status: number, body: string): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } })) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

describe('HttpError unserializable request bodies', () => {
  it('constructs normally when the request body is a circular structure', () => {
    const circular: Record<string, unknown> = { name: 'flow' }
    circular['self'] = circular

    const error = new HttpError(circular, { status: 402, responseBody: 'payment required' })

    expect(error).toBeInstanceOf(HttpError)
    expect(error.response.status).toBe(402)
    expect(error.response.body).toBe('payment required')
    // Programmatic access still holds the original body.
    expect(error.request.body).toBe(circular)
    expect(error.errorMessage()).toEqual({
      response: { status: 402, body: 'payment required' },
      request: { body: circular },
    })
    // The message must exist and must not have thrown.
    expect(typeof error.message).toBe('string')
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('surfaces an HttpError (not a JSON.stringify TypeError) when a failed request carried an unserializable body', async () => {
    // A urlencoded body is passed through serializeBody without JSON.stringify,
    // so a circular value reaches HttpError's constructor when the response fails.
    const restore = stubFetchStatus(400, '{"error":"bad request"}')
    try {
      const circular: Record<string, unknown> = { graph: null }
      circular['graph'] = { parent: circular }

      const failure = await new FetchHttpClient()
        .sendRequest({
          method: HttpMethod.POST,
          url: 'http://127.0.0.1:9/submit',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: circular,
        })
        .then(
          () => undefined,
          (error: unknown) => error
        )

      expect(failure).toBeInstanceOf(HttpError)
      expect((failure as HttpError).response.status).toBe(400)
      expect((failure as HttpError).response.body).toEqual({ error: 'bad request' })
    } finally {
      restore()
    }
  })

  it('keeps the serialized shape for plain serializable bodies', () => {
    const error = new HttpError({ a: 1 }, { status: 400, responseBody: { b: 2 } })

    expect(error.message).toBe(
      JSON.stringify({
        response: { status: 400, body: { b: 2 } },
        request: { body: { a: 1 } },
      })
    )
  })
})
