import { ApplicationEventName } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('platform webhooks entitlement (plan.eventStreamingEnabled)', () => {
    it('should reject list/create with 402 when eventStreamingEnabled is false', async () => {
        const ctx = await createTestContext(app!, { plan: { eventStreamingEnabled: false } })

        const list = await ctx.get('/v1/event-destinations')
        expect(list?.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)

        const create = await ctx.post('/v1/event-destinations', {
            url: 'https://example.com/webhook',
            events: [ApplicationEventName.CONNECTION_UPSERTED],
        })
        expect(create?.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)
    })

    it('should allow list/create when eventStreamingEnabled is true', async () => {
        const ctx = await createTestContext(app!, { plan: { eventStreamingEnabled: true } })

        const create = await ctx.post('/v1/event-destinations', {
            url: 'https://example.com/webhook',
            events: [ApplicationEventName.CONNECTION_UPSERTED],
        })
        expect(create?.statusCode).toBe(StatusCodes.OK)
        expect(create?.json().platformId).toBe(ctx.platform.id)

        const list = await ctx.get('/v1/event-destinations')
        expect(list?.statusCode).toBe(StatusCodes.OK)
    })
})
