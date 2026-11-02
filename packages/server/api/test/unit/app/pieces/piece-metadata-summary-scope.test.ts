import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Cross-scope count attribution in toPieceMetadataModelSummary (the #625 class):
// the mapper pairs every filtered row with its "original" by NAME ALONE. When
// the same name exists in several scopes (an official row plus a platform-scoped
// custom row — both served together in platform-less views like the engine/worker
// list), find() returns the FIRST same-name row, so the platform row reports the
// OFFICIAL piece's action/trigger counts. The unique row identity here is
// (name, platformId) — the same key the entity's unique index and
// lastVersionOfEachPiece's dedupe use.

const mockFindOneBy = vi.fn()
const mockFindOne = vi.fn()
const mockInvalidate = vi.fn()

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOneBy: mockFindOneBy,
        findOne: mockFindOne,
        find: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        save: vi.fn(),
        createQueryBuilder: vi.fn(),
    }),
}))

vi.mock('../../../../src/app/file/file.service', () => ({
    fileService: () => ({ save: vi.fn() }),
    fileRepo: () => ({
        find: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
        findOneBy: vi.fn(),
        save: vi.fn(),
    }),
}))

vi.mock('../../../../src/app/file/s3-helper', () => ({
    s3Helper: () => ({ deleteFiles: vi.fn().mockResolvedValue(undefined) }),
}))

vi.mock('../../../../src/app/pieces/metadata/piece-cache', () => ({
    pieceCache: () => ({
        loadRegistry: vi.fn().mockResolvedValue([]),
        invalidate: mockInvalidate,
    }),
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

type SummaryRow = {
    id: string
    name: string
    version: string
    platformId?: string
    actions: Record<string, unknown>
    triggers: Record<string, unknown>
}

const officialRow: SummaryRow = {
    id: 'row-official',
    name: 'shared-piece',
    version: '2.1.0',
    actions: { a1: {}, a2: {}, a3: {} },
    triggers: { t1: {}, t2: {} },
}

const platformRow: SummaryRow = {
    id: 'row-platform',
    name: 'shared-piece',
    version: '0.3.0',
    platformId: 'acme',
    actions: { only: {} },
    triggers: {},
}

async function loadMapper() {
    const mod = await import('../../../../src/app/pieces/metadata/piece-metadata-service')
    return mod.toPieceMetadataModelSummary
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('toPieceMetadataModelSummary — scope-aware original matching', () => {
    it('counts the platform row\'s own actions/triggers, not the same-name official row\'s', async () => {
        const toPieceMetadataModelSummary = await loadMapper()

        // translatedPieces carries both scopes; official comes first — the
        // pre-fix name-only find() attributes its counts to the platform row.
        const result = toPieceMetadataModelSummary([platformRow], [officialRow, platformRow], undefined)

        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('row-platform')
        expect(result[0].actions).toBe(1)
        expect(result[0].triggers).toBe(0)
    })

    it('counts the official row correctly when it appears first in the filtered list', async () => {
        const toPieceMetadataModelSummary = await loadMapper()

        const result = toPieceMetadataModelSummary([officialRow], [officialRow, platformRow], undefined)

        expect(result).toHaveLength(1)
        expect(result[0].actions).toBe(3)
        expect(result[0].triggers).toBe(2)
    })

    it('keeps exact counts when scopes do not collide on a name', async () => {
        const toPieceMetadataModelSummary = await loadMapper()

        const loneRow: SummaryRow = { ...officialRow, name: 'solo-piece' }
        const result = toPieceMetadataModelSummary([loneRow], [loneRow], undefined)

        expect(result[0].actions).toBe(3)
        expect(result[0].triggers).toBe(2)
    })
})
