import { PieceType } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Uninstall archive-leak regression: pieceMetadataService.delete() removed the
// piece_metadata rows but left the archive File row (and its S3 object / stored
// bytes) behind. Nothing ever cleans PACKAGE_ARCHIVE files — the hourly
// FILE_CLEANUP_TRIGGER job only sweeps flow-run/trigger/webhook payload types —
// so every custom-piece uninstall leaked its uploaded archive forever.
//
// The fix deletes the metadata rows first (fk_piece_metadata_file is ON DELETE
// RESTRICT, so the referencing side must go first), then removes the archive
// files scoped to (id IN deleted archiveIds, platformId, PACKAGE_ARCHIVE),
// best-effort: a cleanup failure must not fail the uninstall.

const mockPieceFindOneBy = vi.fn()
const mockPieceFind = vi.fn()
const mockPieceDelete = vi.fn().mockResolvedValue({ affected: 1 })
const mockFileFind = vi.fn()
const mockFileDelete = vi.fn().mockResolvedValue({ affected: 1 })
const mockS3Delete = vi.fn().mockResolvedValue(undefined)
const mockCacheInvalidate = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOneBy: mockPieceFindOneBy,
        findOne: vi.fn(),
        find: mockPieceFind,
        delete: mockPieceDelete,
        save: vi.fn(),
        createQueryBuilder: vi.fn(),
    }),
}))

vi.mock('../../../../src/app/file/file.service', () => ({
    fileService: () => ({ save: vi.fn() }),
    fileRepo: () => ({
        find: mockFileFind,
        delete: mockFileDelete,
        findOneBy: vi.fn(),
        save: vi.fn(),
    }),
}))

vi.mock('../../../../src/app/file/s3-helper', () => ({
    s3Helper: () => ({ deleteFiles: mockS3Delete }),
}))

vi.mock('../../../../src/app/pieces/metadata/piece-cache', () => ({
    pieceCache: () => ({ invalidate: mockCacheInvalidate }),
}))

vi.mock('../../../../src/app/pieces/metadata/piece-list-cache', () => ({
    pieceListCache: {
        getVersion: vi.fn().mockResolvedValue(0),
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn(),
        putIfCurrent: vi.fn(),
        invalidate: vi.fn(),
    },
}))

vi.mock('../../../../src/app/pieces/tags/pieces/piece-tag.service', () => ({
    pieceTagService: () => ({}),
}))

vi.mock('../../../../src/app/pieces/metadata/utils', () => ({
    filterPieceBasedOnType: vi.fn(),
    isNewerVersion: vi.fn(),
    isSupportedRelease: vi.fn(),
    lastVersionOfEachPiece: vi.fn(),
    loadDevPiecesIfEnabled: vi.fn().mockResolvedValue([]),
    pieceListUtils: {},
}))

vi.mock('../../../../src/app/pieces/metadata/utils/file-pieces-utils', () => ({
    filePiecesUtils: {},
}))

vi.mock('../../../../src/app/pieces/metadata/utils/piece-filtering-hooks', () => ({
    pieceFilteringHooks: {},
}))

vi.mock('../../../../src/app/pieces/metadata/local-piece-catalog', () => ({
    localPieceCatalog: {
        normalizePieceName: (name: string) => name,
        getLocalCatalog: () => [],
        getLocalRegistry: () => [],
        findLocalPiece: () => undefined,
    },
}))

vi.mock('../../../../src/app/database/redis-connections', () => ({
    distributedLock: () => ({
        runExclusive: ({ fn }: { fn: () => Promise<unknown> }) => fn(),
    }),
}))

const mockLog: FastifyBaseLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

const PLATFORM_ID = 'plat-1'

const installedPieceRow = (version: string, archiveId: string) => ({
    id: `row-${version}`,
    name: '@custom/leaky-piece',
    version,
    platformId: PLATFORM_ID,
    pieceType: PieceType.CUSTOM,
    packageType: 'ARCHIVE',
    archiveId,
})

beforeEach(() => {
    vi.clearAllMocks()
    mockPieceDelete.mockResolvedValue({ affected: 1 })
    mockFileDelete.mockResolvedValue({ affected: 1 })
})

async function loadService() {
    const mod = await import('../../../../src/app/pieces/metadata/piece-metadata-service')
    return mod.pieceMetadataService(mockLog)
}

async function seedSingleVersionPiece(archiveId: string, s3Key: string | undefined) {
    const row = installedPieceRow('0.1.0', archiveId)
    mockPieceFindOneBy.mockResolvedValue(row)
    mockPieceFind.mockResolvedValue([row])
    mockFileFind.mockResolvedValue([{ id: archiveId, s3Key }])
}

describe('pieceMetadataService.delete() — uninstall must remove the piece archives', () => {
    it('deletes the archive file row and its S3 object along with the piece rows', async () => {
        await seedSingleVersionPiece('arch-1', 'pieces/arch-1.tgz')

        const service = await loadService()
        await service.delete({ id: 'row-0.1.0', platformId: PLATFORM_ID })

        expect(mockPieceDelete).toHaveBeenCalledWith({
            name: '@custom/leaky-piece',
            platformId: PLATFORM_ID,
            pieceType: PieceType.CUSTOM,
        })
        expect(mockS3Delete).toHaveBeenCalledWith(['pieces/arch-1.tgz'])
        expect(mockFileDelete).toHaveBeenCalledWith({ id: 'arch-1' })
    })

    it('removes every version\'s archive (deduped) when all versions are deleted', async () => {
        const rows = [installedPieceRow('0.1.0', 'arch-1'), installedPieceRow('0.2.0', 'arch-2')]
        mockPieceFindOneBy.mockResolvedValue(rows[1])
        mockPieceFind.mockResolvedValue(rows)
        mockFileFind.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
            const ids = (where.id as { value: string[] }).value
            return ids.map((id) => ({ id, s3Key: `pieces/${id}.tgz` }))
        })

        const service = await loadService()
        await service.delete({ id: 'row-0.2.0', platformId: PLATFORM_ID })

        expect(mockS3Delete).toHaveBeenCalledWith(['pieces/arch-1.tgz', 'pieces/arch-2.tgz'])
        expect(mockFileDelete).toHaveBeenCalledTimes(2)
        const deletedFileIds = mockFileDelete.mock.calls.map((call) => (call[0] as { id: string }).id).sort()
        expect(deletedFileIds).toEqual(['arch-1', 'arch-2'])
    })

    it('deletes the piece rows BEFORE the archive file rows (fk_piece_metadata_file is RESTRICT)', async () => {
        await seedSingleVersionPiece('arch-1', 'pieces/arch-1.tgz')
        const callOrder: string[] = []
        mockPieceDelete.mockImplementation(async () => {
            callOrder.push('piece-delete')
            return { affected: 1 }
        })
        mockFileDelete.mockImplementation(async () => {
            callOrder.push('file-delete')
            return { affected: 1 }
        })

        const service = await loadService()
        await service.delete({ id: 'row-0.1.0', platformId: PLATFORM_ID })

        expect(callOrder).toEqual(['piece-delete', 'file-delete'])
    })

    it('skips file deletion when the custom piece has no archive (registry installs)', async () => {
        const row = { ...installedPieceRow('0.1.0', 'arch-1'), packageType: 'REGISTRY', archiveId: null }
        mockPieceFindOneBy.mockResolvedValue(row)
        mockPieceFind.mockResolvedValue([row])

        const service = await loadService()
        await service.delete({ id: 'row-0.1.0', platformId: PLATFORM_ID })

        expect(mockFileDelete).not.toHaveBeenCalled()
        expect(mockS3Delete).not.toHaveBeenCalled()
    })

    it('still invalidates the cache and does not fail the uninstall when archive cleanup fails', async () => {
        await seedSingleVersionPiece('arch-1', 'pieces/arch-1.tgz')
        mockFileFind.mockRejectedValue(new Error('file repo down'))

        const service = await loadService()
        await expect(service.delete({ id: 'row-0.1.0', platformId: PLATFORM_ID })).resolves.toBeUndefined()

        expect(mockCacheInvalidate).toHaveBeenCalled()
        expect(mockLog.warn).toHaveBeenCalled()
    })

    it('scopes the archive lookup to the uninstalling platform', async () => {
        await seedSingleVersionPiece('arch-1', 'pieces/arch-1.tgz')

        const service = await loadService()
        await service.delete({ id: 'row-0.1.0', platformId: PLATFORM_ID })

        expect(mockFileFind).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ platformId: PLATFORM_ID }),
        }))
    })
})
