import { describe, expect, it } from 'vitest'
import { HttpMethod } from '../src/lib/http/core/http-method'
import { FetchHttpClient } from '../src/lib/http/core/fetch-http-client'

type CapturedCall = { url: string; body: BodyInit | null | undefined };

function captureFetch(): { calls: () => CapturedCall[]; restore: () => void } {
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body })
    return new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { calls: () => calls, restore: () => { globalThis.fetch = originalFetch } }
}

describe('array-valued params serialize as repeated keys', () => {
  it('repeats array query params instead of comma-joining them', async () => {
    const capture = captureFetch()
    try {
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.GET,
        url: 'http://127.0.0.1:9/items',
        // URLSearchParams semantics: a list value means repeated keys.
        queryParams: { ids: ['1', '2', '3'] } as unknown as Record<string, string>,
      })

      expect(capture.calls()[0].url).toBe('http://127.0.0.1:9/items?ids=1&ids=2&ids=3')
    } finally {
      capture.restore()
    }
  })

  it('repeats array values in urlencoded bodies instead of comma-joining them', async () => {
    const capture = captureFetch()
    try {
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.POST,
        url: 'http://127.0.0.1:9/filter',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { ids: ['1', '2'], q: 'x' },
      })

      expect(capture.calls()[0].body).toBe('ids=1&ids=2&q=x')
    } finally {
      capture.restore()
    }
  })

  it('keeps single-value urlencoded bodies byte-identical', async () => {
    const capture = captureFetch()
    try {
      await new FetchHttpClient().sendRequest({
        method: HttpMethod.POST,
        url: 'http://127.0.0.1:9/filter',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: { a: 'hello world', b: '2' },
      })

      expect(capture.calls()[0].body).toBe('a=hello+world&b=2')
    } finally {
      capture.restore()
    }
  })
})
