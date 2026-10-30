import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCustomApiCallAction } from '../src/lib/helpers'
import { HttpRequest } from '../src/lib/http/core/http-request'
import { httpClient } from '../src/lib/http'

// createCustomApiCallAction's run() delegates to the httpClient singleton,
// which the test swaps out to capture the request it would send.
type SendRequestCapture = {
  requests: HttpRequest[];
  restore: () => void;
};

function captureSendRequest(): SendRequestCapture {
  const original = httpClient.sendRequest.bind(httpClient)
  const requests: HttpRequest[] = []
  httpClient.sendRequest = (async (request: HttpRequest) => {
    requests.push(request)
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { ok: true },
    }
  }) as typeof httpClient.sendRequest
  return { requests, restore: () => { httpClient.sendRequest = original } }
}

const runContext = (method: 'GET' | 'POST', relativePath: string, extraProps: Record<string, unknown> = {}) =>
  ({
    propsValue: {
      method,
      url: { url: relativePath },
      headers: {},
      queryParams: {},
      body_type: 'none',
      failsafe: false,
      response_is_binary: false,
      followRedirects: false,
      ...extraProps,
    },
    auth: { username: 'user-1', password: 'secret-token' },
  }) as never

describe('createCustomApiCallAction authLocation handling', () => {
  let capture: SendRequestCapture

  beforeEach(() => {
    capture = captureSendRequest()
  })

  afterEach(() => {
    capture.restore()
  })

  it('sends auth in query params only when authLocation is queryParams', async () => {
    const action = createCustomApiCallAction({
      baseUrl: () => 'https://api.example.test',
      authLocation: 'queryParams',
      authMapping: async (auth) => ({
        key: (auth as { username: string }).username,
        token: (auth as { password: string }).password,
      }),
    })

    await action.run(runContext('GET', '/cards'))

    expect(capture.requests).toHaveLength(1)
    const request = capture.requests[0]
    expect(request.queryParams?.token).toBe('secret-token')
    expect(request.queryParams?.key).toBe('user-1')
    // The auth mapping must NOT leak into headers for query-param auth.
    expect(request.headers?.token).toBeUndefined()
    expect(request.headers?.key).toBeUndefined()
  })

  it('sends auth in headers only when authLocation is headers (the default)', async () => {
    const action = createCustomApiCallAction({
      baseUrl: () => 'https://api.example.test',
      authMapping: async (auth) => ({
        Authorization: `Bearer ${(auth as { password: string }).password}`,
      }),
    })

    await action.run(runContext('GET', '/cards'))

    expect(capture.requests).toHaveLength(1)
    const request = capture.requests[0]
    expect(request.headers?.Authorization).toBe('Bearer secret-token')
    expect(request.queryParams?.Authorization).toBeUndefined()
  })

  it('lets user query params override auth query params', async () => {
    const action = createCustomApiCallAction({
      baseUrl: () => 'https://api.example.test',
      authLocation: 'queryParams',
      authMapping: async () => ({ token: 'auth-token' }),
    })

    await action.run(runContext('GET', '/cards', { queryParams: { token: 'user-value' } }))

    const request = capture.requests[0]
    expect(request.queryParams?.token).toBe('user-value')
    expect(request.headers?.token).toBeUndefined()
  })
})
