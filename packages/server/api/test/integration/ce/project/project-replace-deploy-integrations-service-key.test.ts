import { apId } from '@inboxfm-connect/core-utils'
import { PackageType, PieceType, ProjectStateSnapshot } from '@inboxfm-connect/shared'
import crypto from 'crypto'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { createMockApiKey, createMockConnectApiKey } from '../../../helpers/mocks'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

// A deployable custom piece: an archive + matching checksum is exactly what
// plan creation requires to emit a `custom_piece` CREATE change, so the apply
// request below reaches Phase 0 (platform-wide piece deployment). The archive
// payload itself is not a valid piece package, so the install fails with a
// custom_piece failure entry instead of installing anything — the assertions
// here are about the AUTHZ GATE, not about a successful install.
function buildSnapshotWithDeployableCustomPiece(): ProjectStateSnapshot {
    const archiveContent = Buffer.from('not-a-real-piece-archive-payload')
    const checksum = crypto.createHash('sha256').update(archiveContent).digest('hex')
    return {
        schemaVersion: 1,
        sourceActivepiecesVersion: '0.120.0',
        exportedAt: new Date().toISOString(),
        tables: [],
        triggerBindings: [],
        scheduledTasks: [],
        mcp: { disabledTools: [] },
        requiredPieces: [],
        customPieces: [{
            name: `acme-internal-piece-${apId()}`,
            version: '1.0.0',
            pieceType: PieceType.CUSTOM,
            packageType: PackageType.ARCHIVE,
            archiveFileBase64: archiveContent.toString('base64'),
            archiveChecksum: checksum,
        }],
        requiredConnections: [],
    }
}

// Creates the signed plan artifact for the given snapshot via the public API,
// as the given credential. Returns the plan (the route may answer 200 for a
// passing preflight — a deployable custom piece passes preflight).
async function createPlanArtifact(
    token: string,
    projectId: string,
    snapshot: ProjectStateSnapshot,
): Promise<Record<string, unknown>> {
    const planRes = await app!.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/replace/plan`,
        headers: { authorization: `Bearer ${token}` },
        body: snapshot,
    })
    expect(planRes.statusCode).toBe(StatusCodes.OK)
    return planRes.json().plan
}

describe('Project Replace - deployCustomIntegrations authz gate (service principals)', () => {
    let ctx: TestContext

    beforeEach(async () => {
        ctx = await createTestContext(app!)
    })

    const applyWithDeployFlag = async (token: string, projectId: string, plan: Record<string, unknown>, snapshot: ProjectStateSnapshot) => {
        return app!.inject({
            method: 'POST',
            url: `/api/v1/projects/${projectId}/replace/apply`,
            headers: { authorization: `Bearer ${token}` },
            body: {
                plan,
                snapshot,
                deployCustomIntegrations: true,
            },
        })
    }

    it('RED -> GREEN: a project-scoped Connect API key (cak-) cannot deploy custom integrations platform-wide', async () => {
        const mockKey = createMockConnectApiKey({ platformId: ctx.platform.id, projectId: ctx.project.id })
        await db.save('connect_api_key', mockKey)

        const snapshot = buildSnapshotWithDeployableCustomPiece()
        // The cak- key can create the plan: it holds READ_PROJECT on its own project.
        const plan = await createPlanArtifact(mockKey.value, ctx.project.id, snapshot)

        const applyRes = await applyWithDeployFlag(mockKey.value, ctx.project.id, plan, snapshot)

        // AFTER THE FIX: the platform-wide deployment gate must refuse a
        // project-scoped service principal before any deployment is attempted.
        expect(applyRes.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(applyRes.json().code).toBe('PERMISSION_DENIED')

        // BEFORE THE FIX (RED): the gate only checked USER principals, so the
        // project-scoped key sailed into applyPlan's Phase 0 and attempted a
        // PieceScope.PLATFORM install of the snapshot's custom piece on the
        // whole platform (observed: 207 MULTI_STATUS with a custom_piece entry).
    })

    it('RED -> GREEN: the combined replace route refuses the same platform-wide deployment for a cak- key', async () => {
        const mockKey = createMockConnectApiKey({ platformId: ctx.platform.id, projectId: ctx.project.id })
        await db.save('connect_api_key', mockKey)

        const snapshot = buildSnapshotWithDeployableCustomPiece()

        const applyRes = await app!.inject({
            method: 'POST',
            url: `/api/v1/projects/${ctx.project.id}/replace`,
            headers: { authorization: `Bearer ${mockKey.value}` },
            body: {
                snapshot,
                deployCustomIntegrations: true,
            },
        })

        expect(applyRes.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(applyRes.json().code).toBe('PERMISSION_DENIED')
    })

    it('control: a platform administrator user still reaches the deployment', async () => {
        const snapshot = buildSnapshotWithDeployableCustomPiece()
        const plan = await createPlanArtifact(ctx.token, ctx.project.id, snapshot)

        const applyRes = await applyWithDeployFlag(ctx.token, ctx.project.id, plan, snapshot)

        // The gate must NOT block the platform admin: the deployment proceeds
        // (and fails only because the archive is not a real piece package).
        expect(applyRes.statusCode).not.toBe(StatusCodes.FORBIDDEN)
        const result = applyRes.json()
        expect(
            result.applied.customPiecesInstalled === 1 ||
            result.failed.some((f: { kind: string }) => f.kind === 'custom_piece'),
        ).toBe(true)
    })

    it('control: a platform-wide API key (sk-) still reaches the deployment', async () => {
        const mockApiKey = createMockApiKey({ platformId: ctx.platform.id })
        await db.save('api_key', mockApiKey)

        const snapshot = buildSnapshotWithDeployableCustomPiece()
        const plan = await createPlanArtifact(mockApiKey.value, ctx.project.id, snapshot)

        const applyRes = await applyWithDeployFlag(mockApiKey.value, ctx.project.id, plan, snapshot)

        // The gate must NOT block the platform-grade credential.
        expect(applyRes.statusCode).not.toBe(StatusCodes.FORBIDDEN)
        const result = applyRes.json()
        expect(
            result.applied.customPiecesInstalled === 1 ||
            result.failed.some((f: { kind: string }) => f.kind === 'custom_piece'),
        ).toBe(true)
    })

    it('control: without the flag, a cak- key can still apply a plan', async () => {
        const mockKey = createMockConnectApiKey({ platformId: ctx.platform.id, projectId: ctx.project.id })
        await db.save('connect_api_key', mockKey)

        const snapshot = buildSnapshotWithDeployableCustomPiece()
        const plan = await createPlanArtifact(mockKey.value, ctx.project.id, snapshot)

        const applyRes = await app!.inject({
            method: 'POST',
            url: `/api/v1/projects/${ctx.project.id}/replace/apply`,
            headers: { authorization: `Bearer ${mockKey.value}` },
            body: {
                plan,
                snapshot,
            },
        })

        // No platform-wide deployment requested: the project-scoped key keeps
        // its project-level replace ability (the plan applies cleanly; the custom
        // piece without the flag is only recorded as unavailable, never deployed
        // and never surfaced as a failure on its own).
        expect(applyRes.statusCode).toBe(StatusCodes.OK)
        expect(applyRes.json().applied.customPiecesInstalled).toBe(0)
    })
})
