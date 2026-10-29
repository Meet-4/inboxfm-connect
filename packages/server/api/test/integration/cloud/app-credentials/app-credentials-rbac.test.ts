import { AppCredentialType, DefaultProjectRole } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMemberContext, createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

function apiKeyCredentialBody(projectId: string, appName: string): Record<string, unknown> {
    return {
        appName,
        projectId,
        settings: { type: AppCredentialType.API_KEY },
    }
}

/**
 * App credentials hold the OAuth2 client id/secret a project's connections are
 * exchanged with, so writing one is credential material, not metadata: the same
 * privilege that guards app connections (WRITE_APP_CONNECTION) must guard it.
 * Before the fix both mutations only required *membership* (`permission`
 * undefined), so a read-only VIEWER could plant or rotate the client secret and
 * point the project's OAuth exchanges at a client it controls.
 */
describe('App credentials — project-role permission enforcement', () => {
    describe('VIEWER (READ_APP_CONNECTION only — no WRITE_APP_CONNECTION)', () => {
        it('cannot create an app credential (POST /v1/app-credentials → 403)', async () => {
            const { viewerCtx, ownerCtx } = await setupViewer()

            const response = await viewerCtx.post('/v1/app-credentials', apiKeyCredentialBody(ownerCtx.project.id, 'viewer-planted-credential'))

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
            expect(response?.json()).toMatchObject({ code: 'PERMISSION_DENIED' })
        })

        it('cannot delete an app credential (DELETE /v1/app-credentials/:id → 403)', async () => {
            const { viewerCtx, ownerCtx } = await setupViewer()

            const created = await ownerCtx.post('/v1/app-credentials', apiKeyCredentialBody(ownerCtx.project.id, 'owner-owned-credential'))
            expect(created?.statusCode).toBe(StatusCodes.OK)
            const credentialId = created?.json().id as string

            const response = await viewerCtx.delete(`/v1/app-credentials/${credentialId}`)

            expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
            expect(response?.json()).toMatchObject({ code: 'PERMISSION_DENIED' })
        })
    })

    describe('EDITOR (READ_APP_CONNECTION + WRITE_APP_CONNECTION) — fix must not block legitimate callers', () => {
        it('can create an app credential', async () => {
            const { editorCtx, ownerCtx } = await setupEditor()

            const response = await editorCtx.post('/v1/app-credentials', apiKeyCredentialBody(ownerCtx.project.id, 'editor-created-credential'))

            expect(response?.statusCode).toBe(StatusCodes.OK)
            expect(response?.json().appName).toBe('editor-created-credential')
        })

        it('can delete an app credential', async () => {
            const { editorCtx, ownerCtx } = await setupEditor()

            const created = await ownerCtx.post('/v1/app-credentials', apiKeyCredentialBody(ownerCtx.project.id, 'editor-deletable-credential'))
            const credentialId = created?.json().id as string

            const response = await editorCtx.delete(`/v1/app-credentials/${credentialId}`)

            expect(response?.statusCode).toBe(StatusCodes.OK)
        })
    })

    describe('Project owner (ADMIN role)', () => {
        it('can create and delete an app credential', async () => {
            const ownerCtx = await createTestContext(app, { plan: { projectRolesEnabled: true } })

            const created = await ownerCtx.post('/v1/app-credentials', apiKeyCredentialBody(ownerCtx.project.id, 'owner-created-credential'))
            expect(created?.statusCode).toBe(StatusCodes.OK)

            const deleted = await ownerCtx.delete(`/v1/app-credentials/${created?.json().id}`)
            expect(deleted?.statusCode).toBe(StatusCodes.OK)
        })
    })
})

type ViewerSetup = { ownerCtx: TestContext, viewerCtx: TestContext }
type EditorSetup = { ownerCtx: TestContext, editorCtx: TestContext }

async function setupViewer(): Promise<ViewerSetup> {
    const ownerCtx = await createTestContext(app, { plan: { projectRolesEnabled: true } })
    const viewerCtx = await createMemberContext(app, ownerCtx, { projectRole: DefaultProjectRole.VIEWER })
    return { ownerCtx, viewerCtx }
}

async function setupEditor(): Promise<EditorSetup> {
    const ownerCtx = await createTestContext(app, { plan: { projectRolesEnabled: true } })
    const editorCtx = await createMemberContext(app, ownerCtx, { projectRole: DefaultProjectRole.EDITOR })
    return { ownerCtx, editorCtx }
}
