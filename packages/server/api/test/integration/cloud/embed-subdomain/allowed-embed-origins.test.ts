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
 * `allowedEmbedOrigins` is the platform-wide iframe allowlist that gates embedding this
 * platform inside a third-party page. It is a platform-level security control, so the
 * route that widens it must be a platform-admin route: `publicPlatform([SERVICE])`
 * admitted any service credential — including a Connect API key bound to a single
 * project — and rejected the platform owner at the same time.
 */
describe('POST /v1/embed-subdomain/allowed-embed-origins', () => {
    const ATTACKER_ORIGIN = 'https://attacker.example'

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

    async function createEmbedEnabledContext(): Promise<TestContext> {
        return createTestContext(app!, { plan: { embeddingEnabled: true } })
    }

    async function mintProjectScopedConnectApiKey(ctx: TestContext): Promise<string> {
        const response = await ctx.post('/v1/connect-api-keys', {
            displayName: 'agent backend key',
            projectId: ctx.project.id,
        })
        expect(response?.statusCode).toBe(StatusCodes.CREATED)
        return response?.json().value as string
    }

    it('denies a project-scoped Connect API key', async () => {
        const ctx = await createEmbedEnabledContext()
        const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

        const response = await injectWithToken(projectScopedKey, {
            method: 'POST',
            url: '/v1/embed-subdomain/allowed-embed-origins',
            payload: { allowedEmbedOrigins: [ATTACKER_ORIGIN] },
        })

        expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
    })

    it('allows the platform owner', async () => {
        const ctx = await createEmbedEnabledContext()

        const response = await ctx.post('/v1/embed-subdomain/allowed-embed-origins', {
            allowedEmbedOrigins: [ATTACKER_ORIGIN],
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        expect(response?.json().allowedEmbedOrigins).toContain(ATTACKER_ORIGIN)
    })

    it('still allows a platform-wide service key', async () => {
        const { mockApiKey } = await mockAndSaveBasicSetupWithApiKey({
            plan: { embeddingEnabled: true },
        })

        const response = await injectWithToken(mockApiKey.value, {
            method: 'POST',
            url: '/v1/embed-subdomain/allowed-embed-origins',
            payload: { allowedEmbedOrigins: [ATTACKER_ORIGIN] },
        })

        expect(response.statusCode).toBe(StatusCodes.OK)
        expect(response.json().allowedEmbedOrigins).toContain(ATTACKER_ORIGIN)
    })
})
