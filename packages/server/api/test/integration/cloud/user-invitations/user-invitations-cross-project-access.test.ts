import { ErrorCode, ProjectRole } from '@inboxfm-connect/core-utils'
import { DefaultProjectRole, InvitationStatus, InvitationType, PlatformRole, PrincipalType } from '@inboxfm-connect/shared'
import { faker } from '@faker-js/faker'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import {
    createMockProject,
    createMockProjectMember,
    createMockUserInvitation,
    mockAndSaveBasicSetup,
    mockBasicUser,
} from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

/**
 * Invitation rows leak invitee emails and the roles they are being granted.
 * Listing them must derive the tenant scope from the authenticated principal,
 * never from a client-supplied projectId: a platform member with no access to
 * a project must not be able to enumerate that project's invitations, and
 * platform-wide listings are the platform-admin console, not a member view.
 */
describe('User Invitation API — cross-project listing authorization', () => {
    it('rejects a platform member listing another project\'s invitations by client-supplied projectId', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup({
            plan: { projectRolesEnabled: true },
        })
        const adminRole = await db.findOneByOrFail<ProjectRole>('project_role', { name: DefaultProjectRole.ADMIN })

        // A second TEAM project in the same platform the attacker has no role in.
        const victimProject = createMockProject({
            platformId: mockPlatform.id,
            ownerId: mockProject.ownerId,
        })
        await db.save('project', victimProject)

        const victimInvitation = createMockUserInvitation({
            email: faker.internet.email(),
            platformId: mockPlatform.id,
            projectId: victimProject.id,
            type: InvitationType.PROJECT,
            status: InvitationStatus.PENDING,
        })
        await db.save('user_invitation', { ...victimInvitation, projectRoleId: adminRole.id })

        // Attacker: a signed-in platform member with no project membership at all.
        const { mockUser: attacker } = await mockBasicUser({
            user: {
                platformId: mockPlatform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const attackerToken = await generateMockToken({
            id: attacker.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/user-invitations',
            query: { type: InvitationType.PROJECT, projectId: victimProject.id },
            headers: { authorization: `Bearer ${attackerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response?.json<{ code?: string }>()?.code).toBe(ErrorCode.AUTHORIZATION)
    })

    it('scopes a member\'s project-type listing to projects they can access, not the whole platform', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup({
            plan: { projectRolesEnabled: true },
        })
        const adminRole = await db.findOneByOrFail<ProjectRole>('project_role', { name: DefaultProjectRole.ADMIN })

        const victimProject = createMockProject({
            platformId: mockPlatform.id,
            ownerId: mockProject.ownerId,
        })
        await db.save('project', victimProject)

        const victimInvitation = createMockUserInvitation({
            email: faker.internet.email(),
            platformId: mockPlatform.id,
            projectId: victimProject.id,
            type: InvitationType.PROJECT,
            status: InvitationStatus.PENDING,
        })
        await db.save('user_invitation', { ...victimInvitation, projectRoleId: adminRole.id })

        const { mockUser: attacker } = await mockBasicUser({
            user: {
                platformId: mockPlatform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const attackerToken = await generateMockToken({
            id: attacker.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        // No projectId in the query: on the base this listed every project
        // invitation of the platform, exposing the victim project's row.
        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/user-invitations',
            query: { type: InvitationType.PROJECT },
            headers: { authorization: `Bearer ${attackerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json<{ data: Array<{ id: string, projectId: string | null }> }>()
        const leakedIds = (body?.data ?? []).filter(invitation => invitation.projectId === victimProject.id)
        expect(leakedIds).toEqual([])
    })

    it('rejects a non-admin platform member listing platform-wide invitations', async () => {
        const { mockPlatform } = await mockAndSaveBasicSetup({
            plan: { projectRolesEnabled: true },
        })

        const platformInvitation = createMockUserInvitation({
            email: faker.internet.email(),
            platformId: mockPlatform.id,
            type: InvitationType.PLATFORM,
            platformRole: PlatformRole.ADMIN,
            status: InvitationStatus.PENDING,
        })
        await db.save('user_invitation', platformInvitation)

        const { mockUser: attacker } = await mockBasicUser({
            user: {
                platformId: mockPlatform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const attackerToken = await generateMockToken({
            id: attacker.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/user-invitations',
            query: { type: InvitationType.PLATFORM },
            headers: { authorization: `Bearer ${attackerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response?.json<{ code?: string }>()?.code).toBe(ErrorCode.AUTHORIZATION)
    })

    it('still lets a project member with read permission list their own project\'s invitations', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup({
            plan: { projectRolesEnabled: true },
        })
        const adminRole = await db.findOneByOrFail<ProjectRole>('project_role', { name: DefaultProjectRole.ADMIN })

        const victimInvitation = createMockUserInvitation({
            email: faker.internet.email(),
            platformId: mockPlatform.id,
            projectId: mockProject.id,
            type: InvitationType.PROJECT,
            status: InvitationStatus.PENDING,
        })
        await db.save('user_invitation', { ...victimInvitation, projectRoleId: adminRole.id })

        const { mockUser: member } = await mockBasicUser({
            user: {
                platformId: mockPlatform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const projectMember = createMockProjectMember({
            userId: member.id,
            platformId: mockPlatform.id,
            projectId: mockProject.id,
            projectRoleId: adminRole.id,
        })
        await db.save('project_member', projectMember)

        const memberToken = await generateMockToken({
            id: member.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/user-invitations',
            query: { type: InvitationType.PROJECT, projectId: mockProject.id },
            headers: { authorization: `Bearer ${memberToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json<{ data: Array<{ id: string }> }>()
        expect(body?.data?.map(invitation => invitation.id)).toContain(victimInvitation.id)
    })

    it('still lets the platform owner list project invitations without a projectId', async () => {
        const { mockPlatform, mockProject, mockOwner } = await mockAndSaveBasicSetup({
            plan: { projectRolesEnabled: true },
        })
        const adminRole = await db.findOneByOrFail<ProjectRole>('project_role', { name: DefaultProjectRole.ADMIN })

        const victimInvitation = createMockUserInvitation({
            email: faker.internet.email(),
            platformId: mockPlatform.id,
            projectId: mockProject.id,
            type: InvitationType.PROJECT,
            status: InvitationStatus.PENDING,
        })
        await db.save('user_invitation', { ...victimInvitation, projectRoleId: adminRole.id })

        const ownerToken = await generateMockToken({
            id: mockOwner.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/user-invitations',
            query: { type: InvitationType.PROJECT },
            headers: { authorization: `Bearer ${ownerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json<{ data: Array<{ id: string }> }>()
        expect(body?.data?.map(invitation => invitation.id)).toContain(victimInvitation.id)
    })
})

