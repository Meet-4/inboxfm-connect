import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectProxyErrorCode, BaseOAuth2ConnectionValue } from '@inboxfm-connect/shared'
import { safeHttp } from '@inboxfm-connect/server-utils'
import { FastifyBaseLogger } from 'fastify'

// Connect proxy outbound header construction: caller-supplied headers are forwarded
// to third-party providers after stripping hop-by-hop and credential headers. The
// strip set originally missed `content-length`, so a caller could pin a body-length
// header that mismatches the body axios actually serializes. Axios (1.x) keeps a
// caller-set content-length instead of recomputing it (`setContentLength(len, false)`
// never rewrites an existing value), so Node writes the full body under the claimed
// length — a request-length-spoofing (smuggling-class) primitive against the
// provider's keep-alive connection. These tests pin that the framing header is
// dropped while legitimate passthrough and credential injection keep working.

const mockRequest = vi.fn()

const mockDecryptAndRefreshConnection = vi.fn()

const mockFindOneBy = vi.fn()

vi.mock('../../../../src/app/app-connection/app-connection-service/app-connection-service', () => ({
    appConnectionsRepo: () => ({
        findOneBy: mockFindOneBy,
    }),
    appConnectionService: () => ({
        decryptAndRefreshConnection: mockDecryptAndRefreshConnection,
    }),
}))

const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
} as unknown as FastifyBaseLogger

async function importService() {
    const { connectProxyService } = await import('../../../../src/app/connect-proxy/connect-proxy.service')
    return connectProxyService(log)
}

function seedSlackConnection() {
    const connection = {
        id: 'conn_1',
        pieceName: 'slack',
        projectIds: ['proj_1'],
        externalId: 'cust_alice',
        status: 'ACTIVE',
        value: {
            access_token: 'slack_secret_token_123',
        } as unknown as BaseOAuth2ConnectionValue,
    }
    mockFindOneBy.mockResolvedValue(connection)
    mockDecryptAndRefreshConnection.mockResolvedValue(connection)
    return connection
}

function seedGithubConnection() {
    const connection = {
        id: 'conn_gh',
        pieceName: 'github',
        projectIds: ['proj_1'],
        externalId: 'cust_alice',
        status: 'ACTIVE',
        value: {
            access_token: 'github_secret_token_123',
        } as unknown as BaseOAuth2ConnectionValue,
    }
    mockFindOneBy.mockResolvedValue(connection)
    mockDecryptAndRefreshConnection.mockResolvedValue(connection)
    return connection
}

describe('connect-proxy outbound header construction', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockRequest.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: {},
            data: {},
        })
        vi.spyOn(safeHttp, 'createAxios').mockReturnValue({ request: mockRequest } as never)
    })

    it('drops a caller-supplied content-length instead of forwarding it upstream', async () => {
        const service = await importService()
        seedSlackConnection()

        await service.execute({
            projectId: 'proj_1',
            externalUserId: 'cust_alice',
            provider: 'slack',
            method: 'POST',
            path: '/chat.postMessage',
            headers: {
                // Framing header must be recomputed by the client, never taken from the caller
                'Content-Length': '999',
                'content-length': '1',
                'X-Custom-Tracking': 'track_abc',
            },
            body: { channel: 'C123', text: 'hello' },
            timeoutMs: 5000,
        })

        const requestArg = mockRequest.mock.calls[0][0]
        const headerKeys = Object.keys(requestArg.headers).map(k => k.toLowerCase())
        expect(headerKeys).not.toContain('content-length')
        // Legitimate custom headers still pass through
        expect(requestArg.headers['X-Custom-Tracking']).toBe('track_abc')
    })

    it('drops hop-by-hop and credential headers but injects the connection token', async () => {
        const service = await importService()
        seedSlackConnection()

        await service.execute({
            projectId: 'proj_1',
            externalUserId: 'cust_alice',
            provider: 'slack',
            method: 'GET',
            path: '/users.info',
            headers: {
                'Authorization': 'Bearer attacker_attempt',
                'Cookie': 'session=leak',
                'Host': 'internal.host',
                'Connection': 'keep-alive',
                'Transfer-Encoding': 'chunked',
                'Proxy-Authorization': 'Basic internal',
            },
            timeoutMs: 5000,
        })

        const requestArg = mockRequest.mock.calls[0][0]
        const headerKeys = Object.keys(requestArg.headers).map(k => k.toLowerCase())
        // The caller's credential attempt must not survive anywhere in the outbound headers
        expect(Object.values(requestArg.headers).some(v => String(v).includes('attacker_attempt'))).toBe(false)
        // The provider credential is injected last and is the only authority-bearing header
        expect(requestArg.headers['Authorization']).toBe('Bearer slack_secret_token_123')
        expect(headerKeys).not.toContain('cookie')
        expect(headerKeys).not.toContain('host')
        expect(headerKeys).not.toContain('connection')
        expect(headerKeys).not.toContain('transfer-encoding')
        expect(headerKeys).not.toContain('proxy-authorization')
    })

    it('keeps forwarding the idempotency key and provider default headers', async () => {
        const service = await importService()
        seedGithubConnection()

        await service.execute({
            projectId: 'proj_1',
            externalUserId: 'cust_alice',
            provider: 'github',
            method: 'GET',
            path: '/user/repos',
            idempotencyKey: 'idemp-req-777',
            timeoutMs: 5000,
        })

        const requestArg = mockRequest.mock.calls[0][0]
        expect(requestArg.headers['Idempotency-Key']).toBe('idemp-req-777')
        expect(requestArg.headers['User-Agent']).toBe('InboxFM-Connect-Proxy/1.0')
        expect(requestArg.headers['Authorization']).toBe('Bearer github_secret_token_123')
    })

    it('sanitizes upstream response headers: strips set-cookie and content-length, keeps data headers', async () => {
        const service = await importService()
        seedSlackConnection()
        mockRequest.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: {
                'set-cookie': 'leak=1',
                'content-length': '4321',
                'x-ratelimit-remaining': '42',
                'content-type': 'application/json',
            },
            data: {},
        })

        const response = await service.execute({
            projectId: 'proj_1',
            externalUserId: 'cust_alice',
            provider: 'slack',
            method: 'GET',
            path: '/users.info',
            timeoutMs: 5000,
        })

        expect(response.headers).toEqual({
            'x-ratelimit-remaining': '42',
            'content-type': 'application/json',
        })
        expect(response.rateLimit).toEqual({ limit: undefined, remaining: 42, reset: undefined })
    })

    it('rejects requests when no active connection matches', async () => {
        const service = await importService()
        mockFindOneBy.mockResolvedValue(null)

        try {
            await service.execute({
                projectId: 'proj_1',
                externalUserId: 'cust_alice',
                provider: 'slack',
                method: 'GET',
                path: '/users.info',
                timeoutMs: 5000,
            })
            expect.unreachable('execute should have thrown CONNECTION_NOT_FOUND')
        }
        catch (error) {
            expect((error as { error?: { params?: { code?: string } } }).error?.params?.code).toBe(ConnectProxyErrorCode.CONNECTION_NOT_FOUND)
        }
    })
})
