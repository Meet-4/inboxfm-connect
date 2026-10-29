import { apId } from '@inboxfm-connect/core-utils'
import { DefaultProjectRole, InvitationStatus, InvitationType, Project, ProjectRole } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../../helpers/db'
import { createMockProject, createMockUserInvitation } from '../../../helpers/mocks'
import { createMemberContext, createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

/**
 * `GET /v1/user-invitations` is guarded by `publicPlatform`, whose
 * `projectResource` only feeds `request.projectId` — it is *not* an
 * authorization check (see authorization-middleware: the PLATFORM branch drops
 * projectResource entirely). The service key branch therefore asserts
 * READ_INVITATION on the project itself, while the user branch returned
 * `request.query.projectId` unchecked, so any platform member could read
 * another project's invitations (invitee emails + roles) by supplying its id.
 */
describe('GET /v1/user-invitations — project scoping for USER principals', () => {
    it('rejects a non-member listing another project\'s invitations (403)', async () => {
        const { viewerCtx, victimProject } = await setup()

        const response = await viewerCtx.get('/v1/user-invitations', {
            type: InvitationType.PROJECT,
            projectId: victimProject.id,
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response?.json()).toMatchObject({ code: 'AUTHORIZATION' })
    })

    it('does not leak the invitation list when another project id is supplied', async () => {
        const { viewerCtx, victimProject, victimEmail } = await setup()

        const response = await viewerCtx.get('/v1/user-invitations', {
            type: InvitationType.PROJECT,
            projectId: victimProject.id,
        })

        const leakedEmails = (response?.json().data ?? []).map((invitation: { email: string }) => invitation.email)
        expect(leakedEmails).not.toContain(victimEmail)
    })

    it('still lets a member list invitations of a project they belong to', async () => {
        const { viewerCtx, ownerCtx, ownEmail } = await setup()

        const response = await viewerCtx.get('/v1/user-invitations', {
            type: InvitationType.PROJECT,
            projectId: ownerCtx.project.id,
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const emails = response?.json().data.map((invitation: { email: string }) => invitation.email)
        expect(emails).toContain(ownEmail)
    })

    it('still lets a platform admin list any project\'s invitations', async () => {
        const { ownerCtx, victimProject, victimEmail } = await setup()

        const response = await ownerCtx.get('/v1/user-invitations', {
            type: InvitationType.PROJECT,
            projectId: victimProject.id,
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const emails = response?.json().data.map((invitation: { email: string }) => invitation.email)
        expect(emails).toContain(victimEmail)
    })
})

type Setup = {
    ownerCtx: TestContext
    viewerCtx: TestContext
    victimProject: Project
    victimEmail: string
    ownEmail: string
}

/**
 * ownerCtx: platform admin + member of `project`.
 * viewerCtx: platform MEMBER with the VIEWER role on `project` only.
 * victimProject: a second project in the same platform that viewer is NOT a member of.
 */
async function setup(): Promise<Setup> {
    const ownerCtx = await createTestContext(app, { plan: { projectRolesEnabled: true } })
    const viewerCtx = await createMemberContext(app, ownerCtx, { projectRole: DefaultProjectRole.VIEWER })

    const victimProject = createMockProject({
        platformId: ownerCtx.platform.id,
        ownerId: ownerCtx.user.id,
        displayName: `victim-project-${apId()}`,
    })
    await db.save('project', victimProject)

    const adminRole = await db.findOneByOrFail<ProjectRole>('project_role', {
        name: DefaultProjectRole.ADMIN,
    })

    const victimEmail = `victim-${apId()}@example.com`
    await db.save('user_invitation', createMockUserInvitation({
        email: victimEmail,
        platformId: ownerCtx.platform.id,
        projectId: victimProject.id,
        type: InvitationType.PROJECT,
        projectRole: adminRole,
        status: InvitationStatus.PENDING,
    }))

    const ownEmail = `own-${apId()}@example.com`
    await db.save('user_invitation', createMockUserInvitation({
        email: ownEmail,
        platformId: ownerCtx.platform.id,
        projectId: ownerCtx.project.id,
        type: InvitationType.PROJECT,
        projectRole: adminRole,
        status: InvitationStatus.PENDING,
    }))

    return { ownerCtx, viewerCtx, victimProject, victimEmail, ownEmail }
}
