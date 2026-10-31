import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { redisConnections } from '../../../../src/app/database/redis-connections'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

// Production default of AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX.
const ABUSE_IP_MAX = 10

async function probeSessionToken(path: string, ip: string, method: 'GET' | 'POST' = 'GET'): Promise<number> {
    const response = await app!.inject({
        method,
        url: `/api/v1/connect-sessions${path}`,
        headers: { 'x-real-ip': ip },
    })
    return response.statusCode
}

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

afterEach(async () => {
    const redis = await redisConnections.useExisting()
    await redis.flushall()
})

describe('Connect-session public token route abuse throttling', () => {
    // The public connect-session routes authenticate ONLY via the bearer
    // capability token in the URL (hashed SHA-256 lookup per attempt) and
    // /:token/mcp-token mints a delegated MCP token. Same shape as the
    // trigger-binding capability URLs (issue #351): the token is the only
    // credential, so unbounded token probing must not be possible.
    it('throttles repeated bogus-token probes from one IP', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await probeSessionToken('/definitely-bogus-token', '198.51.100.240')
            expect(status).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
        const throttled = await probeSessionToken('/definitely-bogus-token', '198.51.100.240')
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })

    it('throttles the mcp-token exchange route too, with per-IP budgets', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await probeSessionToken('/definitely-bogus-token/mcp-token', '198.51.100.241', 'POST')
            expect(status).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
        const throttled = await probeSessionToken('/definitely-bogus-token/mcp-token', '198.51.100.241', 'POST')
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)

        const otherIp = await probeSessionToken('/definitely-bogus-token', '198.51.100.242')
        expect(otherIp).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
    })
})
