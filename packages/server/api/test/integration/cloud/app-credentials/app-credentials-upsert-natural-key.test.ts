import { AppCredentialType, UpsertAppCredentialRequest } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { appCredentialService } from '../../../../src/app/ee/app-credentials/app-credentials.service'
import { db } from '../../../helpers/db'
import { createTestContext, TestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null
let ctx: TestContext

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    ctx = await createTestContext(app!)
})

type AppCredentialRow = {
    id: string
    settings: {
        type: string
        clientId?: string
    }
}

const oauth2Request = (projectId: string, clientId: string): UpsertAppCredentialRequest => ({
    appName: 'natural-key-app',
    projectId,
    settings: {
        type: AppCredentialType.OAUTH2,
        authUrl: 'https://example.com/auth',
        tokenUrl: 'https://example.com/token',
        clientId,
        clientSecret: `secret-${clientId}`,
        scope: 'read',
    },
})

describe('appCredentialService.upsert() — natural key (projectId, appName)', () => {
    it('duplicate upserts for the same (projectId, appName) converge to ONE row with a stable id', async () => {
        // Pre-fix: the upsert conflicted on ['id'] with a fresh apId() per call, so
        // both calls were bare INSERTs and two rows existed for one logical
        // credential — the read-back then served an arbitrary one.
        const first = await appCredentialService.upsert({
            projectId: ctx.project.id,
            request: oauth2Request(ctx.project.id, 'client-a'),
        })
        expect(first?.id).toBeDefined()

        const second = await appCredentialService.upsert({
            projectId: ctx.project.id,
            request: oauth2Request(ctx.project.id, 'client-b'),
        })

        const rows = await db.findManyBy<AppCredentialRow>('app_credential', {
            projectId: ctx.project.id,
            appName: 'natural-key-app',
        })
        expect(rows).to.have.lengthOf(1)
        expect(second?.id).to.be.equal(first?.id)
        expect(rows[0]!.id).to.be.equal(first?.id)
    })

    it('a second upsert updates settings in place (id stable, one row)', async () => {
        const first = await appCredentialService.upsert({
            projectId: ctx.project.id,
            request: oauth2Request(ctx.project.id, 'client-a'),
        })

        const second = await appCredentialService.upsert({
            projectId: ctx.project.id,
            request: oauth2Request(ctx.project.id, 'client-rotated'),
        })

        // Same logical credential, new settings — the row is updated in place,
        // never replaced by a fresh id.
        expect(second?.id).to.be.equal(first?.id)

        const rows = await db.findManyBy<AppCredentialRow>('app_credential', {
            projectId: ctx.project.id,
            appName: 'natural-key-app',
        })
        expect(rows).to.have.lengthOf(1)
        expect(rows[0]!.id).to.be.equal(first?.id)
        // Settings are encrypted at rest (the row's column only holds the
        // {iv, data} envelope); the rotated client id surfaces through the
        // service's decrypted read-back instead.
        expect((second?.settings as { clientId: string }).clientId).to.be.equal('client-rotated')
    })

    it('two concurrent upserts for the same natural key converge to one row (no duplicate insert)', async () => {
        // Double-click / retry: both calls race with no client-supplied id. The
        // unique index plus ON CONFLICT on (projectId, appName) must make the
        // loser converge on the winner's row instead of inserting a duplicate.
        const results = await Promise.allSettled([
            appCredentialService.upsert({
                projectId: ctx.project.id,
                request: oauth2Request(ctx.project.id, 'client-race-1'),
            }),
            appCredentialService.upsert({
                projectId: ctx.project.id,
                request: oauth2Request(ctx.project.id, 'client-race-2'),
            }),
        ])

        for (const result of results) {
            expect(result.status).to.be.equal('fulfilled', `upsert rejected: ${JSON.stringify(result)}`)
        }

        const rows = await db.findManyBy<AppCredentialRow>('app_credential', {
            projectId: ctx.project.id,
            appName: 'natural-key-app',
        })
        expect(rows).to.have.lengthOf(1)

        const rowId = rows[0]!.id
        for (const result of results) {
            if (result.status === 'fulfilled') {
                expect(result.value?.id).to.be.equal(rowId)
            }
        }
    })

    it('keeps credentials for different app names and different projects independent', async () => {
        // The unique index is scoped to (projectId, appName): another project may
        // hold the same app name, and the same project may hold several apps.
        const otherProjectCtx = await createTestContext(app!)

        const sameNameOtherProject = await appCredentialService.upsert({
            projectId: otherProjectCtx.project.id,
            request: oauth2Request(otherProjectCtx.project.id, 'client-a'),
        })
        const otherAppName = await appCredentialService.upsert({
            projectId: ctx.project.id,
            request: {
                ...oauth2Request(ctx.project.id, 'client-a'),
                appName: 'natural-key-app-2',
            },
        })

        expect(sameNameOtherProject?.id).to.not.be.equal(otherAppName?.id)

        const rowsInProject = await db.findManyBy<AppCredentialRow>('app_credential', {
            projectId: ctx.project.id,
        })
        expect(rowsInProject).to.have.lengthOf(1)

        const rowsInOtherProject = await db.findManyBy<AppCredentialRow>('app_credential', {
            projectId: otherProjectCtx.project.id,
        })
        expect(rowsInOtherProject).to.have.lengthOf(1)
    })
})
