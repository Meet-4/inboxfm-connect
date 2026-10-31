import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectError, InboxFM } from '../src/index'

function client(overrides: Partial<ConstructorParameters<typeof InboxFM>[0]> = {}): InboxFM {
    return new InboxFM({
        apiKey: 'test-key',
        projectId: 'project-a',
        baseUrl: 'https://api.example.com',
        retryBaseDelayMs: 1,
        retryMaxDelayMs: 5,
        ...overrides,
    })
}

// The README pins the contract under test: "Every failed request rejects with a
// `ConnectError` (never a bare `Error`)". The non-2xx paths were already typed;
// these tests pin the remaining hole — a 2xx whose body is not the promised JSON.
describe('ConnectError-only contract', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('rejects with a typed ConnectError when a 200 response body is an HTML error page', async () => {
        // Captive portals and misrouted gateways answer with 200 + HTML. The JSON
        // body parse used to escape as a bare SyntaxError, so callers' only error
        // handling (`instanceof ConnectError`) never fired.
        fetchMock.mockResolvedValue(new Response('<html>Sign in to the network</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }))

        await expect(client().listConnections({ externalUserId: 'user_1' })).rejects.toBeInstanceOf(ConnectError)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('rejects with a typed ConnectError when a 201 response body is empty', async () => {
        fetchMock.mockResolvedValue(new Response('', { status: 201 }))

        await expect(client().createConnectSession({ externalUserId: 'user_1' })).rejects.toMatchObject({
            name: 'ConnectError',
            category: 'server',
            retryable: true,
            message: 'Response body was not valid JSON',
        })
    })

    it('keeps the underlying parse failure reachable as the error cause', async () => {
        fetchMock.mockResolvedValue(new Response('<html>Sign in to the network</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
        }))

        const error = await client().listConnections({ externalUserId: 'user_1' }).catch((caught: unknown) => caught)

        expect(error).toBeInstanceOf(ConnectError)
        expect((error as ConnectError).cause).toBeInstanceOf(SyntaxError)
    })
})
