import { describe, expect, it } from 'vitest'
import { HttpMethod } from '../src/lib/http/core/http-method'
import { FetchHttpClient } from '../src/lib/http/core/fetch-http-client'

function captureFetchUrl(): { url: () => string; restore: () => void } {
  const originalFetch = globalThis.fetch
  let calledUrl = ''
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calledUrl = String(input)
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return {
    url: () => calledUrl,
    restore: () => {
      globalThis.fetch = originalFetch
    },
  }
}

describe('FetchHttpClient query param serialization', () => {
  it('omits undefined query params instead of serializing the string "undefined"', async () => {
    const capture = captureFetchUrl()
    try {
      // Callers routinely pass optional/absent values (e.g. spread user input);
      // the client already skips undefined *header* values, query params must
      // not turn them into a literal "undefined" parameter.
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/search',
        queryParams: { q: 'hello', page: undefined } as unknown as Record<string, string>,
      })

      expect(capture.url()).toBe('http://127.0.0.1:9/search?q=hello')
    } finally {
      capture.restore()
    }
  })

  it('omits undefined query params from the URL string too', async () => {
    const capture = captureFetchUrl()
    try {
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/search?cursor=abc',
        queryParams: { cursor: undefined } as unknown as Record<string, string>,
      })

      // The undefined request param must not duplicate the URL's own param
      // as a literal "undefined" value (previously "?cursor=abc&cursor=undefined").
      expect(capture.url()).toBe('http://127.0.0.1:9/search?cursor=abc')
    } finally {
      capture.restore()
    }
  })

  it('keeps defined values and merges URL params with request params', async () => {
    const capture = captureFetchUrl()
    try {
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/search?a=1',
        queryParams: { b: '2' },
      })

      expect(capture.url()).toBe('http://127.0.0.1:9/search?a=1&b=2')
    } finally {
      capture.restore()
    }
  })

  it('null query params are still sent explicitly', async () => {
    const capture = captureFetchUrl()
    try {
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/search',
        queryParams: { since: null } as unknown as Record<string, string>,
      })

      expect(capture.url()).toBe('http://127.0.0.1:9/search?since=null')
    } finally {
      capture.restore()
    }
  })
})
