import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { redisConnections } from '../../../../src/app/database/redis-connections'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

// Production default of AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX.
const ABUSE_IP_MAX = 10

// Any non-429 status the handler itself produces (500 from the missing SAML
// config, 200 from a null discovery result) counts as "not throttled".
async function requestOnce({ method, url, payload }: { method: 'GET' | 'POST', url: string, payload?: Record<string, unknown> }): Promise<number> {
    const injectOptions = {
        method,
        url,
        headers: { 'x-real-ip': '198.51.100.220' },
        ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
    }
    const response = await app!.inject(injectOptions)
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

describe('SAML authn public surface abuse throttling', () => {
    // GET /v1/authn/saml/login, POST /v1/authn/saml/acs (signed-assertion
    // verification + redirect token handoff) and POST /v1/authn/saml/discover
    // (platform-by-domain oracle) are all securityAccess.public() with no
    // principal — unbounded request handling on the SSO entrypoints.
    it('throttles repeated /login requests from one IP', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await requestOnce({ method: 'GET', url: '/api/v1/authn/saml/login' })
            expect(status).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
        const throttled = await requestOnce({ method: 'GET', url: '/api/v1/authn/saml/login' })
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })

    it('throttles repeated /acs assertion-consumption attempts from one IP', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await requestOnce({ method: 'POST', url: '/api/v1/authn/saml/acs', payload: { SAMLResponse: 'probe' } })
            expect(status).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
        const throttled = await requestOnce({ method: 'POST', url: '/api/v1/authn/saml/acs', payload: { SAMLResponse: 'probe' } })
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })

    it('throttles repeated /discover domain probes from one IP', async () => {
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await requestOnce({ method: 'POST', url: '/api/v1/authn/saml/discover', payload: { domain: 'probe.example' } })
            expect(status).not.toBe(StatusCodes.TOO_MANY_REQUESTS)
        }
        const throttled = await requestOnce({ method: 'POST', url: '/api/v1/authn/saml/discover', payload: { domain: 'probe.example' } })
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })
})
