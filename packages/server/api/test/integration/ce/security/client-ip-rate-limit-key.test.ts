import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { redisConnections } from '../../../../src/app/database/redis-connections'
import { createMockSignUpRequest } from '../../../helpers/mocks/authn'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

// Production default of AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX (10 per
// window per IP), read eagerly by the abuse tier — tests exercise real defaults.
const ABUSE_IP_MAX = 10

// A sign-up that is NOT throttled or otherwise rejected returns 200.
async function signUp(headers: Record<string, string>, remoteAddress?: string): Promise<number> {
    const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/authentication/sign-up',
        headers,
        body: createMockSignUpRequest(),
        ...(remoteAddress ? { remoteAddress } : {}),
    })
    return response.statusCode
}

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    await databaseConnection().getRepository('flag').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('project').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('platform').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('user').createQueryBuilder().delete().execute()
    await databaseConnection().getRepository('user_identity').createQueryBuilder().delete().execute()
})

afterEach(async () => {
    const redis = await redisConnections.useExisting()
    await redis.flushall()
})

describe('Rate-limit client-IP keying (x-real-ip trust)', () => {
    it('buckets a directly-connected client by its socket address even when it rotates the client-IP header', async () => {
        // The abuse tier must key on an address the client cannot choose. A
        // directly connected public client rotating `x-real-ip` per request is
        // the spoofable-key bypass: each rotation must NOT buy a fresh bucket.
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await signUp({ 'x-real-ip': `198.51.100.${i}` }, '203.0.113.7')
            expect(status).toBe(StatusCodes.OK)
        }
        for (let i = 0; i < 2; i++) {
            const status = await signUp({ 'x-real-ip': `198.51.200.${i}` }, '203.0.113.7')
            expect(status).toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
    })

    it('still honors distinct client-IP headers arriving through a trusted proxy socket', async () => {
        // app.inject originates from a loopback socket — the local reverse
        // proxy position. Distinct end-user IPs behind that proxy must keep
        // getting distinct buckets (this is the behavior the existing abuse
        // tests and every proxied deployment rely on).
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await signUp({ 'x-real-ip': `198.51.100.${100 + i}` })
            expect(status).toBe(StatusCodes.OK)
        }
        // The same proxied IP is now over its own budget, while every distinct
        // one above was under it: hammer one header value to its cap.
        for (let i = 0; i < ABUSE_IP_MAX - 1; i++) {
            const status = await signUp({ 'x-real-ip': '198.51.100.100' })
            expect(status).toBe(StatusCodes.OK)
        }
        const status = await signUp({ 'x-real-ip': '198.51.100.100' })
        expect(status).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })

    it('rejects non-IP client-IP header values instead of keying buckets on arbitrary strings', async () => {
        // Garbage header values must collapse to the socket address bucket,
        // not act as unlimited fresh identities.
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await signUp({ 'x-real-ip': `garbage-identity-${i}` })
            expect(status).toBe(StatusCodes.OK)
        }
        const status = await signUp({ 'x-real-ip': 'garbage-identity-fresh' })
        expect(status).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })
})
