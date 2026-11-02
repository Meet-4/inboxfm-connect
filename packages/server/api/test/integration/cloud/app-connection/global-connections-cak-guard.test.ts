import { apId } from '@inboxfm-connect/core-utils'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { createMockConnectApiKey, mockAndSaveBasicSetup } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

const setupWithGlobalConnections = () => {
    return mockAndSaveBasicSetup({
        platform: {},
        plan: {
            globalConnectionsEnabled: true,
        },
    })
}

describe('project-scoped Connect API keys on global (platform) connection routes', () => {
    // The global-connection module is platformAdminOnly, whose authorization
    // short-circuits for SERVICE principals — a cak- (SERVICE principal bound
    // to one project) must be refused by the route itself, or a project
    // member with WRITE_API_KEY can create, update or DELETE platform-shared
    // connections through a minted key.

    const mintCak = async () => {
        const { mockPlatform, mockProject } = await setupWithGlobalConnections()
        const cak = createMockConnectApiKey({ platformId: mockPlatform.id, projectId: mockProject.id })
        await db.save('connect_api_key', cak)
        return { cak, mockProject }
    }

    it('cak- is forbidden from listing global connections', async () => {
        const { cak } = await mintCak()

        const response = await app!.inject({
            method: 'GET',
            url: '/api/v1/global-connections',
            headers: { authorization: `Bearer ${cak.value}` },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('cak- is forbidden from creating a global connection', async () => {
        const { cak, mockProject } = await mintCak()

        const response = await app!.inject({
            method: 'POST',
            url: '/api/v1/global-connections',
            headers: { authorization: `Bearer ${cak.value}` },
            payload: {
                displayName: 'Escalated Connection',
                pieceName: '@inboxfm-connect/piece-slack',
                scope: 'PLATFORM',
                projectIds: [mockProject.id],
                type: 'SECRET_TEXT',
                value: { type: 'SECRET_TEXT', secret_text: 'escalated-secret' },
            },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('cak- is forbidden from updating a global connection', async () => {
        const { cak } = await mintCak()

        const response = await app!.inject({
            method: 'POST',
            url: `/api/v1/global-connections/${apId()}`,
            headers: { authorization: `Bearer ${cak.value}` },
            payload: { displayName: 'Renamed By Project Key' },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('cak- is forbidden from deleting a global connection', async () => {
        const { cak } = await mintCak()

        const response = await app!.inject({
            method: 'DELETE',
            url: `/api/v1/global-connections/${apId()}`,
            headers: { authorization: `Bearer ${cak.value}` },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })
})
