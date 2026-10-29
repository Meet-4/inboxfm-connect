import { ProjectRole, RoleType } from '@inboxfm-connect/core-utils'
import { PlatformRole, PrincipalType, UpdateProjectRoleRequestBody } from '@inboxfm-connect/shared'
import { faker } from '@faker-js/faker'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import { createMockProjectRole, mockAndSaveBasicSetup, mockBasicUser } from '../../../helpers/mocks'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})
describe('Project Role API', () => {
    describe('Create Project Role', () => {
        it('should create a new project role', async () => {
            const ctx = await createTestContext(app!)

            const projectRole = createMockProjectRole({ platformId: ctx.platform.id })

            const response = await ctx.post('/v1/project-roles', projectRole as unknown as Record<string, unknown>)

            expect(response?.statusCode).toBe(StatusCodes.CREATED)
            const responseBody = response?.json() as ProjectRole
            expect(responseBody.id).toBeDefined()
            expect(responseBody.platformId).toBe(ctx.platform.id)
            expect(responseBody.name).toBe(projectRole.name)
            expect(responseBody.permissions).toEqual(projectRole.permissions)
        })

        it('should fail to create a new project role if user is not platform owner', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const projectRole = createMockProjectRole({ platformId: mockPlatform.id })

            const response = await app?.inject({
                method: 'POST',
                url: '/api/v1/project-roles',
                body: projectRole,
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })

    describe('Get Project Role', () => {
        it('should get all project roles', async () => {
            const ctx = await createTestContext(app!)

            const response = await ctx.get('/v1/project-roles')
            expect(response?.statusCode).toBe(StatusCodes.OK)
        })

        it('should able to get all project roles if user is not platform owner', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const response = await app?.inject({
                method: 'GET',
                url: '/api/v1/project-roles',
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect(response?.statusCode).toBe(StatusCodes.OK)
        })
    })

    describe('Get Project Role by id', () => {
        it('should not return a project role owned by another platform', async () => {
            const ctx = await createTestContext(app!)
            const { mockPlatform: otherPlatform } = await mockAndSaveBasicSetup()
            const foreignRole = createMockProjectRole({
                platformId: otherPlatform.id,
                type: RoleType.CUSTOM,
            })
            await db.save('project_role', foreignRole)

            // The id is the only input, and ids are global across platforms, so an
            // unscoped lookup hands the caller another tenant's role name, permissions
            // and platformId.
            const response = await ctx.get(`/v1/project-roles/${foreignRole.id}`)

            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
            expect(response?.json()).not.toHaveProperty('permissions')
        })

        it('should return a project role owned by the caller platform', async () => {
            const ctx = await createTestContext(app!)
            const projectRole = createMockProjectRole({
                platformId: ctx.platform.id,
                type: RoleType.CUSTOM,
            })
            await db.save('project_role', projectRole)

            const response = await ctx.get(`/v1/project-roles/${projectRole.id}`)

            expect(response?.statusCode).toBe(StatusCodes.OK)
            const responseBody = response?.json() as ProjectRole
            expect(responseBody.id).toBe(projectRole.id)
            expect(responseBody.platformId).toBe(ctx.platform.id)
        })
    })

    describe('List Project Members for Project Role', () => {
        it('should refuse to list platform members for a non-admin user', async () => {
            const ctx = await createTestContext(app!)
            const projectRole = createMockProjectRole({
                platformId: ctx.platform.id,
                type: RoleType.CUSTOM,
            })
            await db.save('project_role', projectRole)

            // Same platform, ordinary MEMBER account: the route used to answer with the
            // whole platform's member rows (emails, names, platformRole, externalId).
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: ctx.platform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: ctx.platform.id },
            })

            const response = await app?.inject({
                method: 'GET',
                url: `/api/v1/project-roles/${projectRole.id}/project-members`,
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
            expect(response?.json()).not.toHaveProperty('data')
        })

        it('should list project members for a platform admin', async () => {
            const ctx = await createTestContext(app!)
            const projectRole = createMockProjectRole({
                platformId: ctx.platform.id,
                type: RoleType.CUSTOM,
            })
            await db.save('project_role', projectRole)

            const response = await ctx.get(`/v1/project-roles/${projectRole.id}/project-members`)

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json()).toHaveProperty('data')
        })
    })

    describe('Update Project Role', () => {
        it('should update a project role', async () => {
            const ctx = await createTestContext(app!)

            const projectRole = createMockProjectRole({ platformId: ctx.platform.id })
            await db.save('project_role', projectRole)

            const request: UpdateProjectRoleRequestBody = {
                name: faker.lorem.word(),
                permissions: ['read', 'write'],
            }

            const response = await ctx.post(`/v1/project-roles/${projectRole.id}`, request as unknown as Record<string, unknown>)
            expect(response?.statusCode).toBe(StatusCodes.OK)
        })

        it('should fail to update if user is not platform owner', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const projectRole = createMockProjectRole({ platformId: mockPlatform.id })
            await db.save('project_role', projectRole)

            const request: UpdateProjectRoleRequestBody = {
                name: faker.lorem.word(),
                permissions: ['read', 'write'],
            }

            const response = await app?.inject({
                method: 'POST',
                url: `/api/v1/project-roles/${projectRole.id}`,
                body: request,
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })
    })

    describe('Delete Project Role', () => {
        it('should delete a project role', async () => {
            const ctx = await createTestContext(app!)

            const projectRole = createMockProjectRole({ platformId: ctx.platform.id })
            await db.save('project_role', projectRole)

            const response = await ctx.delete(`/v1/project-roles/${projectRole.name}`)
            expect(response?.statusCode).toBe(StatusCodes.OK)
        })

        it('should fail to delete a project role if user is not platform owner', async () => {
            const { mockPlatform } = await mockAndSaveBasicSetup()
            const { mockUser } = await mockBasicUser({
                user: {
                    platformId: mockPlatform.id,
                    platformRole: PlatformRole.MEMBER,
                },
            })
            const testToken = await generateMockToken({
                type: PrincipalType.USER,
                id: mockUser.id,
                platform: { id: mockPlatform.id },
            })

            const projectRole = createMockProjectRole({ platformId: mockPlatform.id })
            await db.save('project_role', projectRole)

            const response = await app?.inject({
                method: 'DELETE',
                url: `/api/v1/project-roles/${projectRole.id}`,
                headers: { authorization: `Bearer ${testToken}` },
            })

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        })

        it('should fail to delete a project role if project role does not exist', async () => {
            const ctx = await createTestContext(app!)

            const response = await ctx.delete(`/v1/project-roles/${faker.lorem.word()}`)
            expect(response?.statusCode).toBe(StatusCodes.NOT_FOUND)
        })
    })
})
