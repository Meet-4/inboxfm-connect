import { apId } from '@inboxfm-connect/core-utils'
import { AppConnectionScope, AppConnectionType, DefaultProjectRole, PackageType, ProjectRole, UpsertGlobalConnectionRequestBody } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../../helpers/db'
import { createMockPieceMetadata, createMockProjectMember } from '../../../helpers/mocks'
import { createMemberContext, createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

type AppConnectionRow = { id: string, externalId: string, projectIds: string[] }

/**
 * Assigning a global (PLATFORM-scope) connection to a project is a platform-admin
 * operation: `projectIds` is what makes the credential usable from that project,
 * and the platform admin page is documented as the only management surface
 * (.agents/features/global-connections.md). `POST /v1/projects/:id` is reachable
 * with WRITE_PROJECT — a *project* role — and its `globalConnectionExternalIds`
 * branch attached any connection of the platform to the caller's project, so a
 * project admin could grant their own project a credential the platform admin
 * never shared with it (`externalId` was already platform-admin-only in the very
 * same handler; `globalConnectionExternalIds` was missed).
 */
describe('POST /v1/projects/:id — globalConnectionExternalIds is platform-admin only', () => {
    it('does not attach a global connection to a project administered by a non-platform-admin', async () => {
        const setup = await setupPlatformWithGlobalConnections()
        const { ctx, mockPieceMetadata } = setup

        const victimProject = await createProject(ctx, 'Victim Project')
        const attackerProject = await createProject(ctx, 'Attacker Project')

        const connection = await createGlobalConnection(ctx.token, {
            pieceName: mockPieceMetadata.name,
            pieceVersion: mockPieceMetadata.version,
            projectIds: [victimProject.id],
        })

        const projectAdminCtx = await makeProjectAdmin(setup, attackerProject.id)

        const response = await projectAdminCtx.post(`/v1/projects/${attackerProject.id}`, {
            globalConnectionExternalIds: [connection.externalId],
        })

        // The project update itself is legitimate (WRITE_PROJECT); only the
        // credential assignment must be dropped.
        expect(response?.statusCode).toBe(StatusCodes.OK)

        const row = await db.findOneByOrFail<AppConnectionRow>('app_connection', { id: connection.id })
        expect(row.projectIds).not.toContain(attackerProject.id)
    })

    it('still lets a platform admin attach a global connection to a project', async () => {
        const { ctx, mockPieceMetadata } = await setupPlatformWithGlobalConnections()

        const victimProject = await createProject(ctx, 'Admin Victim Project')
        const targetProject = await createProject(ctx, 'Admin Target Project')

        const connection = await createGlobalConnection(ctx.token, {
            pieceName: mockPieceMetadata.name,
            pieceVersion: mockPieceMetadata.version,
            projectIds: [victimProject.id],
        })

        const response = await ctx.post(`/v1/projects/${targetProject.id}`, {
            globalConnectionExternalIds: [connection.externalId],
        })
        expect(response?.statusCode).toBe(StatusCodes.OK)

        const row = await db.findOneByOrFail<AppConnectionRow>('app_connection', { id: connection.id })
        expect(row.projectIds).toContain(targetProject.id)
    })
})

async function setupPlatformWithGlobalConnections(): Promise<{ ctx: TestContext, mockPieceMetadata: ReturnType<typeof createMockPieceMetadata> }> {
    const ctx = await createTestContext(app, {
        plan: {
            globalConnectionsEnabled: true,
            projectRolesEnabled: true,
        },
    })

    const mockPieceMetadata = createMockPieceMetadata({
        platformId: ctx.platform.id,
        packageType: PackageType.REGISTRY,
    })
    await db.save('integration_metadata', mockPieceMetadata)

    return { ctx, mockPieceMetadata }
}

async function createProject(ctx: TestContext, displayName: string): Promise<{ id: string }> {
    const response = await ctx.post('/v1/projects', { displayName })
    expect(response?.statusCode).toBe(StatusCodes.CREATED)
    return response!.json()
}

async function createGlobalConnection(
    token: string,
    params: { pieceName: string, pieceVersion: string, projectIds: string[] },
): Promise<AppConnectionRow> {
    const body: UpsertGlobalConnectionRequestBody = {
        displayName: `conn-${apId()}`,
        pieceName: params.pieceName,
        pieceVersion: params.pieceVersion,
        projectIds: params.projectIds,
        scope: AppConnectionScope.PLATFORM,
        type: AppConnectionType.SECRET_TEXT,
        value: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: `secret-${apId()}`,
        },
    }

    const response = await app.inject({
        method: 'POST',
        url: '/api/v1/global-connections',
        headers: { authorization: `Bearer ${token}` },
        body,
    })

    expect(response.statusCode).toBe(StatusCodes.CREATED)
    return response.json()
}

/**
 * A user with the ADMIN project role on `projectId` but only the MEMBER platform
 * role — i.e. a project administrator who is *not* a platform admin.
 */
async function makeProjectAdmin(setup: { ctx: TestContext }, projectId: string): Promise<TestContext> {
    const projectAdminCtx = await createMemberContext(app, setup.ctx, { projectRole: DefaultProjectRole.ADMIN })

    const adminRole = await db.findOneByOrFail<ProjectRole>('project_role', {
        name: DefaultProjectRole.ADMIN,
    })

    await db.save('project_member', createMockProjectMember({
        userId: projectAdminCtx.user.id,
        platformId: setup.ctx.platform.id,
        projectId,
        projectRoleId: adminRole.id,
    }))

    return projectAdminCtx
}
