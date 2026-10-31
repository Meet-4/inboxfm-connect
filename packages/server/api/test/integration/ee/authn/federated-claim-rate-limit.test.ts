import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { redisConnections } from '../../../../src/app/database/redis-connections'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

// Production default of AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX.
const ABUSE_IP_MAX = 10

async function postFederated(url: string, ip: string): Promise<number> {
    const response = await app!.inject({
        method: 'POST',
        url,
        headers: { 'x-real-ip': ip },
        payload: JSON.stringify({ code: 'probe-code' }),
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

describe('Federated authn public surface abuse throttling', () => {
    // POST /v1/authn/federated/claim exchanges a claim code for a full platform
    // session and GET .../login builds the provider redirect — both
    // securityAccess.public() with no principal. /claim triggers an outbound
    // token exchange per request and mints a platform token on success: the
    // unauthenticated entrypoint must sit behind the same abuse tier as
    // sign-in, not accept unlimited attempts.
    it('throttles repeated /claim attempts from one IP', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await postFederated('/api/v1/authn/federated/claim', '198.51.100.230')
            expect(status).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
        const throttled = await postFederated('/api/v1/authn/federated/claim', '198.51.100.230')
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })

    it('gives a different IP its own /claim budget', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            await postFederated('/api/v1/authn/federated/claim', '198.51.100.231')
        }
        const overBudget = await postFederated('/api/v1/authn/federated/claim', '198.51.100.231')
        expect(overBudget).toBe(StatusCodes.TOO_MANY_REQUESTS)

        const otherIp = await postFederated('/api/v1/authn/federated/claim', '198.51.100.232')
        expect(otherIp).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
    })
})
