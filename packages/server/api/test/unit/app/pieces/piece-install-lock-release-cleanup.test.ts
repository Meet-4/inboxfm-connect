import { PackageType, PieceCategory } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Regression (issue #555): installPiece's orphaned-archive cleanup keyed "the piece row
// was persisted" on pieceMetadataService.create() RESOLVING. But create() runs inside
// distributedLock().runExclusive -> redlock.using(), and redlock's contract allows the
// .using() promise to reject with a LockError AFTER the locked callback has already
// completed - the lock was lost during execution (auto-extension failed) or the release
// itself failed against a hiccuping redis.
//
// In that window the row is committed and references the uploaded archive, yet
// `piecePersisted` was still false, so the catch treated the committed row as "never
// written" and deleted the archive - an installed piece that can never load.
//
// The fix routes a persisted signal out of create() via onPiecePersisted, fired the
// moment save() returns inside the lock, so the cleanup's predicate reflects the
// database write rather than the promise chain.
//
// Unlike piece-install-archive-cleanup.test.ts (which mocks create() outright) and
// piece-metadata-create-race.test.ts (which drives create() alone), this suite runs the
// REAL installPiece() through the REAL create(), with only the lock seam mocked - the
// one place the post-callback rejection can be injected faithfully.

// -- repo layer (pieceRepos(): existence check, created-date read, the insert itself)

const mockFindOneBy = vi.fn()
const mockFindOne = vi.fn()
const mockSave = vi.fn()
const mockCreateQueryBuilder = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOneBy: mockFindOneBy,
        findOne: mockFindOne,
        save: mockSave,
        createQueryBuilder: mockCreateQueryBuilder,
    }),
}))

// -- the real create()'s collaborators, so create() itself can run unmocked

const mockCacheInvalidate = vi.fn()

vi.mock('../../../../src/app/pieces/metadata/piece-cache', () => ({
    pieceCache: () => ({ invalidate: mockCacheInvalidate }),
    PieceRegistryEntry: {},
}))

vi.mock('../../../../src/app/pieces/metadata/piece-list-cache', () => ({
    pieceListCache: () => ({}),
}))

vi.mock('../../../../src/app/pieces/tags/pieces/piece-tag.service', () => ({
    pieceTagService: () => ({}),
}))

vi.mock('../../../../src/app/pieces/metadata/local-piece-catalog', () => ({
    localPieceCatalog: () => ({}),
}))

vi.mock('../../../../src/app/pieces/metadata/utils', () => ({
    filterPieceBasedOnType: vi.fn(),
    isNewerVersion: vi.fn(),
    isSupportedRelease: vi.fn(),
    lastVersionOfEachPiece: vi.fn(),
    loadDevPiecesIfEnabled: vi.fn(),
    pieceListUtils: {},
}))

vi.mock('../../../../src/app/pieces/metadata/utils/file-pieces-utils', () => ({
    filePiecesUtils: {},
}))

vi.mock('../../../../src/app/pieces/metadata/utils/piece-filtering-hooks', () => ({
    pieceFilteringHooks: {},
}))

// -- the lock seam: redlock's post-callback rejection, injected exactly where it lives.
// The .using() contract means the promise can reject with a LockError after the locked
// callback completed. Simulated by running fn() to completion and only then rejecting;
// the .then() never runs if fn() itself rejects, so a genuine create() failure still
// propagates as-is.
const injectedLockErrors: Error[] = []

vi.mock('../../../../src/app/database/redis-connections', () => ({
    distributedLock: () => ({
        runExclusive: ({ fn }: { fn: () => Promise<unknown> }) => fn().then((result) => {
            const injected = injectedLockErrors.shift()
            if (injected) {
                throw injected
            }
            return result
        }),
    }),
}))

const lockReleaseFailure = (): Error => {
    const error = new Error('redlock: unable to release the lock after the callback ran')
    error.name = 'LockError'
    return error
}

// -- installPiece's collaborators (archive upload/removal, engine extraction, tool-search)

const mockFileSave = vi.fn()
const mockFileDelete = vi.fn()
const mockS3Delete = vi.fn()

vi.mock('../../../../src/app/file/file.service', () => ({
    fileService: () => ({ save: mockFileSave }),
    fileRepo: () => ({ delete: mockFileDelete }),
}))

vi.mock('../../../../src/app/file/s3-helper', () => ({
    s3Helper: () => ({ deleteFiles: mockS3Delete }),
}))

vi.mock('../../../../src/app/helper/promise-handler', () => ({
    rejectedPromiseHandler: vi.fn(),
}))

vi.mock('../../../../src/app/tool-search/tool-search-flag', () => ({
    isToolSearchEnabled: () => false,
}))

vi.mock('../../../../src/app/tool-search/tool-search-reindex.job', () => ({
    toolSearchReindexJob: () => ({ enqueue: vi.fn() }),
}))

// The engine round-trip that reads a piece's metadata out of the uploaded archive.
vi.mock('../../../../src/app/helper/user-interaction/user-interaction-watcher', () => ({
    userInteractionWatcher: {
        submitAndWaitForResponse: async () => ({
            status: 'OK',
            response: {
                name: 'my-piece',
                version: '1.0.0',
                description: 'a piece',
                category: PieceCategory.UTILITY,
                author: 'someone',
                tags: [],
            },
        }),
    },
}))

const mockLog: FastifyBaseLogger = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), child: vi.fn(), silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

async function loadService() {
    const mod = await import('../../../../src/app/pieces/piece-install-service')
    return mod.pieceInstallService(mockLog)
}

const ARCHIVE_FILE = { id: 'archive-1', s3Key: 's3/archive-1' }

const request = {
    packageType: PackageType.ARCHIVE,
    pieceArchive: { data: Buffer.from('zip-bytes') },
} as unknown as Parameters<ReturnType<typeof loadService> extends Promise<infer T> ? T : never>['installPiece'] extends (...a: infer A) => unknown ? A[1] : never

describe('installPiece archive cleanup under a redlock post-callback rejection (#555)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        injectedLockErrors.length = 0
        mockFileSave.mockResolvedValue(ARCHIVE_FILE)
        mockS3Delete.mockResolvedValue(undefined)
        mockFileDelete.mockResolvedValue({ affected: 1 })
        // create()'s in-lock existence check sees no winner yet; findOldestCreatedDate()
        // reads the earliest row for the piece name.
        mockFindOneBy.mockResolvedValue(null)
        mockFindOne.mockResolvedValue({ created: '2026-01-01T00:00:00.000Z' })
        mockSave.mockImplementation(async (entity) => ({ id: 'piece-1', ...entity }))
        mockCacheInvalidate.mockResolvedValue(undefined)
    })

    it('keeps the archive when the lock rejects after the row was saved', async () => {
        // The exact #555 window: create()'s callback ran to completion - the row is
        // committed and references the archive - and only then does redlock fail the
        // .using() promise.
        injectedLockErrors.push(lockReleaseFailure())

        const service = await loadService()
        await expect(service.installPiece('platform-1', request)).rejects.toMatchObject({
            error: {
                code: 'ENGINE_OPERATION_FAILURE',
                params: { message: 'redlock: unable to release the lock after the callback ran' },
            },
        })

        // Proof the rejection is post-callback, not mid-callback: the save ran, and so
        // did the cache refresh that follows it inside the lock.
        expect(mockSave).toHaveBeenCalledTimes(1)
        expect(mockCacheInvalidate).toHaveBeenCalledTimes(1)

        // The row exists and references the archive, so the cleanup must not fire.
        expect(mockFileDelete).not.toHaveBeenCalled()
        expect(mockS3Delete).not.toHaveBeenCalled()
    })

    it('still removes the archive when the insert fails and no row exists', async () => {
        // The other side of the guard: a genuine failure before the row commits must
        // keep cleaning up, or the fix would regress the #475 leak it builds on.
        mockSave.mockRejectedValue(new Error('insert failed'))

        const service = await loadService()
        await expect(service.installPiece('platform-1', request)).rejects.toMatchObject({
            error: {
                code: 'ENGINE_OPERATION_FAILURE',
                params: { message: 'insert failed' },
            },
        })

        expect(mockFileDelete).toHaveBeenCalledWith({ id: 'archive-1' })
        expect(mockS3Delete).toHaveBeenCalledWith(['s3/archive-1'])
    })

    it('still removes the archive on the lost race, rejected before the insert', async () => {
        // The winner's row is already there when the in-lock re-check runs, so this
        // install never saves a row - its archive is unreferenced and must be removed.
        mockFindOneBy.mockResolvedValue({ id: 'piece-winner' })

        const service = await loadService()
        await expect(service.installPiece('platform-1', request)).rejects.toMatchObject({
            error: { code: 'VALIDATION' },
        })

        expect(mockSave).not.toHaveBeenCalled()
        expect(mockFileDelete).toHaveBeenCalledWith({ id: 'archive-1' })
        expect(mockS3Delete).toHaveBeenCalledWith(['s3/archive-1'])
    })

    it('resolves cleanly and touches no files when the lock is released normally', async () => {
        const service = await loadService()
        await expect(service.installPiece('platform-1', request)).resolves.toMatchObject({
            name: 'my-piece',
            version: '1.0.0',
        })

        expect(mockFileDelete).not.toHaveBeenCalled()
        expect(mockS3Delete).not.toHaveBeenCalled()
    })
})
