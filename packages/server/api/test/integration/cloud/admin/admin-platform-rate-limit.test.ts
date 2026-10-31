import { ApEdition } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { redisConnections } from '../../../../src/app/database/redis-connections'
import { system } from '../../../../src/app/helper/system/system'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

// Production default of AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX.
const ABUSE_IP_MAX = 10

// .env.tests sets AP_API_KEY=api-key
const WRONG_ADMIN_KEY = 'wrong-admin-key'

async function postApplyLicenseKey(apiKey: string, ip: string): Promise<number> {
    const response = await app!.inject({
        method: 'POST',
        url: '/api/v1/admin/platforms/apply-license-key',
        headers: { 'api-key': apiKey, 'x-real-ip': ip },
        body: { email: 'user@example.com', licenseKey: 'lk_probe' },
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

describe('Admin platform route abuse throttling', () => {
    // Every /v1/admin route is public + gated ONLY on the shared admin api-key
    // header compare (constant-time since #369). Without a rate limit, key
    // guessing on these platform-mutating routes runs at line rate.
    it('throttles repeated wrong admin-key probes from one IP', async () => {
        if (system.getEdition() !== ApEdition.CLOUD) {
            return
        }

        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await postApplyLicenseKey(WRONG_ADMIN_KEY, '198.51.100.210')
            expect(status).toBe(StatusCodes.FORBIDDEN)
        }

        const throttled = await postApplyLicenseKey(WRONG_ADMIN_KEY, '198.51.100.210')
        expect(throttled).toBe(StatusCodes.TOO_MANY_REQUESTS)
    })

    it('does not count the correct key against the wrong-key budget of another IP', async () => {
        if (system.getEdition() !== ApEdition.CLOUD) {
            return
        }
        // Sanity that the tier does not lock out legitimate admin traffic from
        // other IPs: a correct-key request from a different IP passes while the
        // probing IP is over budget.
        for (let i = 0; i < ABUSE_IP_MAX; i++) {
            const status = await postApplyLicenseKey(WRONG_ADMIN_KEY, '198.51.100.211')
            expect(status).toBe(StatusCodes.FORBIDDEN)
        }
        const overBudget = await postApplyLicenseKey(WRONG_ADMIN_KEY, '198.51.100.211')
        expect(overBudget).toBe(StatusCodes.TOO_MANY_REQUESTS)

        const otherIp = await postApplyLicenseKey(WRONG_ADMIN_KEY, '198.51.100.212')
        expect(otherIp).toBe(StatusCodes.FORBIDDEN)
    })
})
