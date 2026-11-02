import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { createMockApiKey, createMockConnectApiKey, mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('project-scoped Connect API keys on platform-admin connection routes', () => {
    // A cak- is minted by a project member (WRITE_API_KEY) and authenticates as
    // a SERVICE principal bound to that one project. These routes are
    // PLATFORM adminOnly, whose authorization short-circuits for SERVICE
    // principals — so the boundary must be enforced in the route itself.

    it('cak- is forbidden from listing platform-wide connections', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
        const cak = createMockConnectApiKey({ platformId: mockPlatform.id, projectId: mockProject.id })
        await db.save('connect_api_key', cak)

        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/platform-connections',
            headers: { authorization: `Bearer ${cak.value}` },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response.json().code).toBe('AUTHORIZATION')
    })

    it('cak- is forbidden from listing platform connection owners (PII)', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup()
        const cak = createMockConnectApiKey({ platformId: mockPlatform.id, projectId: mockProject.id })
        await db.save('connect_api_key', cak)

        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/platform-connections/owners',
            headers: { authorization: `Bearer ${cak.value}` },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('a platform-wide sk- key still lists platform connections and owners', async () => {
        const { mockPlatform } = await mockAndSaveBasicSetup()
        const sk = createMockApiKey({ platformId: mockPlatform.id })
        await db.save('api_key', sk)
        const headers = { authorization: `Bearer ${sk.value}` }

        const listResponse = await app!.inject({ method: 'GET', url: '/api/v1/platform-connections', headers })
        expect(listResponse.statusCode).toBe(StatusCodes.OK)

        const ownersResponse = await app!.inject({ method: 'GET', url: '/api/v1/platform-connections/owners', headers })
        expect(ownersResponse.statusCode).toBe(StatusCodes.OK)
    })

    it('a platform admin user still lists platform connections', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.get('/v1/platform-connections')

        expect(response?.statusCode).toBe(StatusCodes.OK)
    })
})
