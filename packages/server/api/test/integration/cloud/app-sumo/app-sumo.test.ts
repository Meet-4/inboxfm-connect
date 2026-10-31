import { ApEdition } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { redisConnections } from '../../../../src/app/database/redis-connections'
import { system } from '../../../../src/app/helper/system/system'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

// Production default of AppSystemProp.API_RATE_LIMIT_AUTHN_ABUSE_MAX (10 per
// window per IP) — the tighter tier shared by every scripted-against auth route.
const ABUSE_IP_MAX = 10

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
describe('AppSumo API', () => {
    describe('Action endpoint', () => {
        it('Activates new accounts', async () => {
            const edition = system.getEdition()
            if (edition !== ApEdition.CLOUD) {
                return
            }
            // arrange
            const mockEmail = 'mock-email'

            const requestBody = {
                action: 'activate',
                plan_id: 'plan_id',
                uuid: 'uuid',
                activation_email: mockEmail,
            }

            const appSumoToken = 'app-sumo-token'

            // act
            const response = await app?.inject({
                method: 'POST',
                url: '/api/v1/appsumo/action',
                headers: {
                    authorization: `Bearer ${appSumoToken}`,
                },
                body: requestBody,
            })

            // assert
            const responseBody = response?.json()
            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            expect(responseBody?.message).toBe('success')
            expect(responseBody?.redirect_url).toBe(
                `https://cloud.activepieces.com/sign-up?email=${mockEmail}`,
            )
        })
    })

    describe('Credential brute-force throttling', () => {
        // Both endpoints gate on ONE shared static secret (AP_APPSUMO_TOKEN) and
        // the /token login returns that secret to the caller on success — an
        // unthrottled guess loop against them is a textbook password brute
        // force at line rate. They must sit behind the same abuse tier as
        // sign-in/sign-up.
        it('throttles repeated wrong-credential logins to /token from one IP', async () => {
            if (system.getEdition() !== ApEdition.CLOUD) {
                return
            }

            for (let i = 0; i < ABUSE_IP_MAX; i++) {
                const response = await app!.inject({
                    method: 'POST',
                    url: '/api/v1/appsumo/token',
                    headers: { 'x-real-ip': '198.51.100.201' },
                    body: { username: `wrong-${i}`, password: `wrong-${i}` },
                })
                expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
            }

            const throttled = await app!.inject({
                method: 'POST',
                url: '/api/v1/appsumo/token',
                headers: { 'x-real-ip': '198.51.100.201' },
                body: { username: 'wrong-again', password: 'wrong-again' },
            })
            expect(throttled.statusCode).toBe(StatusCodes.TOO_MANY_REQUESTS)
        })

        it('throttles repeated wrong-bearer probes to /action from one IP', async () => {
            if (system.getEdition() !== ApEdition.CLOUD) {
                return
            }

            for (let i = 0; i < ABUSE_IP_MAX; i++) {
                const response = await app!.inject({
                    method: 'POST',
                    url: '/api/v1/appsumo/action',
                    headers: { authorization: 'Bearer wrong-secret', 'x-real-ip': '198.51.100.202' },
                    body: {
                        action: 'activate',
                        plan_id: 'plan_id',
                        uuid: 'uuid',
                        activation_email: 'email',
                    },
                })
                expect(response.statusCode).toBe(StatusCodes.UNAUTHORIZED)
            }

            const throttled = await app!.inject({
                method: 'POST',
                url: '/api/v1/appsumo/action',
                headers: { authorization: 'Bearer wrong-secret', 'x-real-ip': '198.51.100.202' },
                body: {
                    action: 'activate',
                    plan_id: 'plan_id',
                    uuid: 'uuid',
                    activation_email: 'email',
                },
            })
            expect(throttled.statusCode).toBe(StatusCodes.TOO_MANY_REQUESTS)
        })

        it('still serves a correct credential below the limit', async () => {
            if (system.getEdition() !== ApEdition.CLOUD) {
                return
            }
            // Matches AP_APPSUMO_TOKEN in .env.tests
            const appSumoToken = 'app-sumo-token'

            const response = await app!.inject({
                method: 'POST',
                url: '/api/v1/appsumo/token',
                headers: { 'x-real-ip': '198.51.100.203' },
                body: { username: appSumoToken, password: appSumoToken },
            })
            expect(response.statusCode).toBe(StatusCodes.OK)
        })
    })
})
