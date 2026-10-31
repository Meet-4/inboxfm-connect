import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PackageType, PieceScope, PieceType } from '@inboxfm-connect/shared'
import { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { MockInstance } from 'vitest'
import { userInteractionWatcher } from '../../../../src/app/helper/user-interaction/user-interaction-watcher'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import { pieceMetadataService } from '../../../../src/app/pieces/metadata/piece-metadata-service'
import { createTestContext } from '../../../helpers/test-context'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

const PIECE_NAME = 'testing-before-new-ci-discord'
const PIECE_VERSION = '0.4.4'

const tgzBuffer = readFileSync(
    join(__dirname, '../../../../src/assets/private-piece-test.tgz'),
)

const mockPieceMetadata = {
    name: PIECE_NAME,
    version: PIECE_VERSION,
    displayName: 'Discord Test Piece',
    logoUrl: 'https://cdn.activepieces.com/pieces/discord.png',
    description: 'Test discord piece',
    auth: undefined,
    actions: {},
    triggers: {},
    minimumSupportedRelease: '0.0.0',
    maximumSupportedRelease: '999.999.999',
    authors: [],
    categories: [],
    i18n: {},
}

let app: FastifyInstance | null = null
let mockLog: FastifyBaseLogger
let interactionSpy: MockInstance

beforeAll(async () => {
    app = await setupTestEnvironment()
    mockLog = app!.log!
})

afterAll(async () => {
    await teardownTestEnvironment()
})

beforeEach(async () => {
    await databaseConnection().getRepository('integration_metadata').createQueryBuilder().delete().execute()
    interactionSpy = vi.spyOn(userInteractionWatcher, 'submitAndWaitForResponse').mockResolvedValue(mockPieceMetadata)
})

afterEach(() => {
    interactionSpy.mockRestore()
})

describe('POST /v1/integrations entitlement (plan.managePiecesEnabled)', () => {
    it('should reject platform-scope piece install with 402 when managePiecesEnabled is false', async () => {
        const ctx = await createTestContext(app!, { plan: { managePiecesEnabled: false } })

        const formData = new FormData()
        formData.append(
            'pieceArchive',
            new Blob([tgzBuffer], { type: 'application/gzip' }),
            'private-piece-test.tgz',
        )
        formData.append('pieceName', PIECE_NAME)
        formData.append('pieceVersion', PIECE_VERSION)
        formData.append('packageType', PackageType.ARCHIVE)
        formData.append('scope', PieceScope.PLATFORM)

        const response = await ctx.inject({
            method: 'POST',
            url: '/api/v1/integrations',
            body: formData,
        })

        expect(response.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)
    })

    it('should install a platform-scope piece when managePiecesEnabled is true', async () => {
        const ctx = await createTestContext(app!, { plan: { managePiecesEnabled: true } })

        const formData = new FormData()
        formData.append(
            'pieceArchive',
            new Blob([tgzBuffer], { type: 'application/gzip' }),
            'private-piece-test.tgz',
        )
        formData.append('pieceName', PIECE_NAME)
        formData.append('pieceVersion', PIECE_VERSION)
        formData.append('packageType', PackageType.ARCHIVE)
        formData.append('scope', PieceScope.PLATFORM)

        const response = await ctx.inject({
            method: 'POST',
            url: '/api/v1/integrations',
            body: formData,
        })

        expect(response.statusCode).toBe(StatusCodes.CREATED)

        const saved = await pieceMetadataService(mockLog).getOrThrow({
            name: PIECE_NAME,
            version: PIECE_VERSION,
            platformId: ctx.platform.id,
        })
        expect(saved.pieceType).toBe(PieceType.CUSTOM)
        expect(saved.packageType).toBe(PackageType.ARCHIVE)
    })
})
