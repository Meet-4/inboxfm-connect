import { ProjectRole } from '@inboxfm-connect/core-utils'
import { ActionBase } from '@inboxfm-connect/pieces-framework'
import { apVersionUtil } from '@inboxfm-connect/server-utils'
import { DefaultProjectRole, PackageType, PieceType } from '@inboxfm-connect/shared'
import { FastifyInstance, InjectOptions } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { pieceListCache } from '../../../../src/app/pieces/metadata/piece-list-cache'
import { db } from '../../../helpers/db'
import { createMockPieceMetadata, createMockProject, createMockProjectMember, mockAndSaveBasicSetupWithApiKey, mockBasicUser } from '../../../helpers/mocks'
import { createMemberContext, createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

/**
 * A Connect API key (`cak-`) is a SERVICE principal bound to exactly one project
 * (`principal.projectId`); a platform-wide `sk-` key is a SERVICE principal with no
 * projectId.
 *
 * `GET /v1/users` (`nonEmbedUsersOnly`), `GET /v1/users/:id` and
 * `GET /v1/platforms/:id` (`publicPlatform`) accept SERVICE principals, declare no
 * `projectResource`, and answer from platform-wide data: every user of every
 * project with their email and platform role, or the platform record with its plan
 * and usage. The `principal.type === SERVICE` short-circuits in the authorization
 * helpers treat both kinds of key as "the platform itself", so nothing stops a
 * project-scoped key from reading the platform.
 *
 * Project-scoped routes (`GET /v1/projects/:id`) must keep working for the key's own
 * project — that is the boundary these tests pin down.
 */
describe('Platform-wide routes vs a project-scoped Connect API key', () => {
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

    /** A second user of the same platform, so `GET /v1/users/:id` has a foreign id to read. */
    async function createSecondPlatformUser(ctx: TestContext): Promise<string> {
        const { mockUser } = await mockBasicUser({
            user: { platformId: ctx.platform.id },
        })
        return mockUser.id
    }

    /** A second project of the same platform, so cross-project reads have a foreign project. */
    async function createSecondPlatformProject(ctx: TestContext): Promise<string> {
        const otherProject = createMockProject({
            ownerId: ctx.user.id,
            platformId: ctx.platform.id,
            displayName: 'Other Team Project',
        })
        await db.save('project', otherProject)
        return otherProject.id
    }

    /** One catalog row, so a knowledge-search read has a piece to find (see the ce knowledge-search suite). */
    async function seedPieceCatalog(): Promise<void> {
        const action = (over: Pick<ActionBase, 'name' | 'displayName' | 'description'>): ActionBase => {
            return { name: over.name, displayName: over.displayName, description: over.description, props: {}, requireAuth: true }
        }
        await db.save('integration_metadata', createMockPieceMetadata({
            name: '@inboxfm-connect/piece-slack',
            displayName: 'Slack',
            version: '1.0.0',
            pieceType: PieceType.OFFICIAL,
            packageType: PackageType.REGISTRY,
            actions: {
                send_channel_message: action({
                    name: 'send_channel_message',
                    displayName: 'Send Channel Message',
                    description: 'Send a message to a Slack channel',
                }),
            },
            triggers: {},
        }))
        await pieceListCache.invalidate(apVersionUtil.getCurrentRelease())
    }

    describe('platform user directory', () => {
        it('denies a project-scoped Connect API key the platform user directory', async () => {
            const ctx = await createTestContext(app!)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'GET',
                url: '/v1/users',
                query: { limit: '10' },
            })

            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('denies a project-scoped Connect API key another user\'s profile', async () => {
            const ctx = await createTestContext(app!)
            const otherUserId = await createSecondPlatformUser(ctx)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'GET',
                url: `/v1/users/${otherUserId}`,
            })

            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('still allows a platform-wide service key to read the directory', async () => {
            const { mockApiKey, mockOwner } = await mockAndSaveBasicSetupWithApiKey()

            const listed = await injectWithToken(mockApiKey.value, {
                method: 'GET',
                url: '/v1/users',
                query: { limit: '10' },
            })
            expect(listed.statusCode).toBe(StatusCodes.OK)

            const fetched = await injectWithToken(mockApiKey.value, {
                method: 'GET',
                url: `/v1/users/${mockOwner.id}`,
            })
            expect(fetched.statusCode).toBe(StatusCodes.OK)
            expect(fetched.json().id).toBe(mockOwner.id)
        })
    })

    describe('platform record', () => {
        it('denies a project-scoped Connect API key the platform record', async () => {
            const ctx = await createTestContext(app!)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'GET',
                url: `/v1/platforms/${ctx.platform.id}`,
            })

            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('still allows a platform-wide service key to read the platform record', async () => {
            const { mockApiKey, mockPlatform } = await mockAndSaveBasicSetupWithApiKey()

            const response = await injectWithToken(mockApiKey.value, {
                method: 'GET',
                url: `/v1/platforms/${mockPlatform.id}`,
            })

            expect(response.statusCode).toBe(StatusCodes.OK)
            expect(response.json().id).toBe(mockPlatform.id)
        })
    })

    describe('cross-project visibility', () => {
        it('denies a project-scoped Connect API key the platform-wide project list', async () => {
            const ctx = await createTestContext(app!)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'GET',
                url: '/v1/projects',
                query: { limit: '10' },
            })

            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('denies a project-scoped Connect API key another project\'s record', async () => {
            const ctx = await createTestContext(app!)
            const otherProjectId = await createSecondPlatformProject(ctx)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'GET',
                url: `/v1/projects/${otherProjectId}`,
            })

            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('denies a project-scoped Connect API key creating a platform project', async () => {
            const ctx = await createTestContext(app!)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'POST',
                url: '/v1/projects',
                body: { displayName: 'Key-Minted Project' },
            })

            expect(response.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('still allows a platform-wide service key to list and create projects', async () => {
            const { mockApiKey } = await mockAndSaveBasicSetupWithApiKey()

            const listed = await injectWithToken(mockApiKey.value, {
                method: 'GET',
                url: '/v1/projects',
                query: { limit: '10' },
            })
            expect(listed.statusCode).toBe(StatusCodes.OK)

            const created = await injectWithToken(mockApiKey.value, {
                method: 'POST',
                url: '/v1/projects',
                body: { displayName: 'Service Key Project' },
            })
            expect(created.statusCode).toBe(StatusCodes.CREATED)
        })
    })

    describe('the legitimate read: knowledge-search catalog', () => {
        it('still allows a project-scoped Connect API key to search the piece catalog', async () => {
            await seedPieceCatalog()
            const ctx = await createTestContext(app!)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'POST',
                url: '/v1/knowledge-search/query',
                body: { query: 'slack' },
            })

            expect(response.statusCode).toBe(StatusCodes.OK)
            const body = response.json()
            expect(Array.isArray(body.results)).toBe(true)
            expect((body.results as { pieceName: string }[]).some((r) => r.pieceName === '@inboxfm-connect/piece-slack')).toBe(true)
        })

        it('still allows a platform-wide service key to search the piece catalog', async () => {
            const { mockApiKey } = await mockAndSaveBasicSetupWithApiKey()

            const response = await injectWithToken(mockApiKey.value, {
                method: 'POST',
                url: '/v1/knowledge-search/query',
                body: { query: 'slack' },
            })

            expect(response.statusCode).toBe(StatusCodes.OK)
        })
    })

    describe('the boundary: project-scoped behaviour is untouched', () => {
        it('still allows the key to read its own project', async () => {
            const ctx = await createTestContext(app!)
            const projectScopedKey = await mintProjectScopedConnectApiKey(ctx)

            const response = await injectWithToken(projectScopedKey, {
                method: 'GET',
                url: `/v1/projects/${ctx.project.id}`,
            })

            expect(response.statusCode).toBe(StatusCodes.OK)
            expect(response.json().id).toBe(ctx.project.id)
        })

        it('still allows a platform user with invite permission to list users', async () => {
            const ctx = await createTestContext(app!)
            const memberCtx = await createMemberContext(app!, ctx, {
                projectRole: DefaultProjectRole.ADMIN,
            })

            const response = await memberCtx.get('/v1/users', { limit: 10 })

            expect(response?.statusCode).toBe(StatusCodes.OK)
        })

        it('still allows a platform user to read a user of their own project', async () => {
            const ctx = await createTestContext(app!)
            const { mockUser } = await mockBasicUser({ user: { platformId: ctx.platform.id } })
            const projectRole = await db.findOneByOrFail<ProjectRole>('project_role', {
                name: DefaultProjectRole.ADMIN,
            })
            await db.save('project_member', createMockProjectMember({
                userId: mockUser.id,
                platformId: ctx.platform.id,
                projectId: ctx.project.id,
                projectRoleId: projectRole.id,
            }))

            const response = await ctx.get(`/v1/users/${mockUser.id}`)

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().id).toBe(mockUser.id)
        })
    })
})
