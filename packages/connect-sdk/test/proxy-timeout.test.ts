import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InboxFM } from '../src/index'

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

// The server's ConnectProxyRequest schema bounds the upstream `timeoutMs` to an
// integer of 500..60000 ms (`packages/core/shared/src/lib/connect-proxy/index.ts`,
// `z.number().int().min(500).max(60000).default(30000)`), while the SDK's
// `ConnectProxyParams.timeoutMs` accepts any number because it doubles as the
// client-side transport timeout. Un-normalized, a caller asking for a 2-minute
// client budget (or a sub-500ms one) put that value into the request body and the
// server rejected EVERY such call with 400 VALIDATION.
describe('proxy upstream timeout normalization', () => {
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        fetchMock = vi.fn()
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 200, statusText: 'OK', headers: {}, data: {}, provider: 'slack' }), { status: 200 }))
        vi.stubGlobal('fetch', fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function sentUpstreamTimeoutMs(): unknown {
        const [, init] = fetchMock.mock.calls[0]
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return body['timeoutMs']
    }

    it.each([
        { requested: 120_000, expected: 60_000, why: 'above the server maximum of 60s' },
        { requested: 70_000, expected: 60_000, why: 'just above the server maximum' },
        { requested: 250, expected: 500, why: 'below the server minimum of 500ms' },
        { requested: 0, expected: 500, why: 'zero clamps to the server minimum' },
        { requested: 1_500.7, expected: 1_501, why: 'non-integers are rounded (the server requires an integer)' },
    ])('clamps $requested to $expected ($why)', async ({ requested, expected }) => {
        await client().proxy({
            externalUserId: 'cust_abc_123',
            provider: 'slack',
            path: '/users.info',
            timeoutMs: requested,
        })

        expect(sentUpstreamTimeoutMs()).toBe(expected)
    })

    it('passes an in-range timeout through unchanged', async () => {
        await client().proxy({
            externalUserId: 'cust_abc_123',
            provider: 'slack',
            path: '/users.info',
            timeoutMs: 5_000,
        })

        expect(sentUpstreamTimeoutMs()).toBe(5_000)
    })

    it('omits the field when the value is not a usable number, so the server default (30s) applies', async () => {
        // JSON.stringify writes NaN as null, which the server's schema rejects
        // the same way as an out-of-range number; dropping it is the only shape
        // the server accepts for an unusable value.
        await client().proxy({
            externalUserId: 'cust_abc_123',
            provider: 'slack',
            path: '/users.info',
            timeoutMs: Number.NaN,
        })

        const [, init] = fetchMock.mock.calls[0]
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect('timeoutMs' in body).toBe(false)
    })

    it('still honors the caller timeoutMs as the client-side transport budget', async () => {
        // The normalization must not leak into the transport: a caller granting
        // 120s of client patience still gets a 120s per-attempt timeout, not the
        // 60s ceiling that applies to the upstream call.
        fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
            if (init.signal.aborted) {
                reject(new DOMException('aborted', 'AbortError'))
                return
            }
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }))

        vi.useFakeTimers()
        try {
            const settled: string[] = []
            void client({ maxAttempts: 1 })
                .proxy({ externalUserId: 'cust_abc_123', provider: 'slack', path: '/users.info', timeoutMs: 120_000 })
                .then(() => settled.push('resolved'), (error: { category?: string }) => settled.push(`rejected:${error.category}`))

            await vi.advanceTimersByTimeAsync(60_000)
            expect(settled).toEqual([])

            await vi.advanceTimersByTimeAsync(59_999)
            expect(settled).toEqual([])
        }
        finally {
            vi.useRealTimers()
        }
    })
})
