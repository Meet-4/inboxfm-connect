import { FastifyBaseLogger } from 'fastify'
import { FindOperator } from 'typeorm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Scope-precedence regression (the #625 class, server side): when the same piece
// name exists BOTH platform-scoped (CUSTOM, platformId set) and official
// (platformId NULL), the two serving paths disagreed.
//
// The LIST path already has the rule (lastVersionOfEachPiece, issue #417):
//   "the platform piece replaces the official one for its platform".
//
// The GET path (pieceMetadataService.get -> findExactVersion) sorted every
// name-matching registry entry purely by version descending and picked the top,
// so the (almost always higher-versioned) OFFICIAL row shadowed the platform's
// custom piece on every lookup that carried no exact version pin — the engine's
// bundle resolution and /v1/integrations/:name resolved the WRONG piece while
// the dashboard list advertised the platform's replacement.

type RegistryEntryLike = {
    name: string
    version: string
    pieceType: string
    platformId?: string
    minimumSupportedRelease?: string
    maximumSupportedRelease?: string
}

type PieceRowLike = RegistryEntryLike & {
    id: string
    packageType: string
    archiveId?: string
}

const OFFICIAL_PLATFORM = 'acme'

let registry: RegistryEntryLike[]
let dbRows: PieceRowLike[]

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
        loadRegistry: async () => registry,
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

vi.mock('../../../../src/app/pieces/metadata/utils', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/app/pieces/metadata/utils')>()
    return {
        ...actual,
        loadDevPiecesIfEnabled: vi.fn().mockResolvedValue([]),
        pieceListUtils: {},
    }
})

vi.mock('../../../../src/app/pieces/metadata/utils/file-pieces-utils', () => ({
    filePiecesUtils: () => ({
        loadDistPiecesMetadata: vi.fn().mockResolvedValue([]),
    }),
}))

vi.mock('../../../../src/app/pieces/metadata/utils/piece-filtering-hooks', () => ({
    pieceFilteringHooks: {
        get: () => ({ isFiltered: vi.fn().mockResolvedValue(false) }),
    },
}))

vi.mock('../../../../src/app/pieces/metadata/local-piece-catalog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../../src/app/pieces/metadata/local-piece-catalog')>()
    return {
        localPieceCatalog: {
            ...actual.localPieceCatalog,
            getLocalCatalog: () => [],
            getLocalRegistry: () => [],
            findLocalPiece: () => undefined,
        },
    }
})

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

// Simulates TypeORM findOne({ where: [condition, ...] }): OR across conditions,
// AND within a condition. IsNull() matches a null column; a missing
// platformId on a row counts as NULL.
function matchRow(row: PieceRowLike, cond: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(cond)) {
        const rowValue = (row as unknown as Record<string, unknown>)[key] ?? null
        if (value instanceof FindOperator) {
            if (rowValue !== null) {
                return false
            }
            continue
        }
        if (rowValue !== value) {
            return false
        }
    }
    return true
}

function seedFindOne(): void {
    mockFindOne.mockImplementation(({ where }: { where: Record<string, unknown>[] }) => {
        const conditions = Array.isArray(where) ? where : [where]
        for (const cond of conditions) {
            const found = dbRows.find((row) => matchRow(row, cond))
            if (found) {
                return found
            }
        }
        return null
    })
}

async function loadService() {
    const mod = await import('../../../../src/app/pieces/metadata/piece-metadata-service')
    return mod.pieceMetadataService(mockLog)
}

beforeEach(() => {
    vi.clearAllMocks()
    registry = []
    dbRows = []
    seedFindOne()
})

describe('pieceMetadataService.get() — platform piece must not be shadowed by a same-name official piece', () => {
    it('prefers the platform-scoped piece when no version is pinned (latest)', async () => {
        registry = [
            { name: 'shared-piece', version: '2.1.0', pieceType: 'OFFICIAL' },
            { name: 'shared-piece', version: '0.3.0', pieceType: 'CUSTOM', platformId: OFFICIAL_PLATFORM },
        ]
        dbRows = [
            { id: 'row-official', name: 'shared-piece', version: '2.1.0', pieceType: 'OFFICIAL', platformId: undefined, packageType: 'REGISTRY' },
            { id: 'row-platform', name: 'shared-piece', version: '0.3.0', pieceType: 'CUSTOM', platformId: OFFICIAL_PLATFORM, packageType: 'ARCHIVE', archiveId: 'arch-1' },
        ]

        const service = await loadService()
        const result = await service.get({ name: 'shared-piece', version: undefined, platformId: OFFICIAL_PLATFORM })

        expect(result?.id).toBe('row-platform')
        expect(result?.version).toBe('0.3.0')
    })

    it('prefers the platform-scoped piece inside a version range that spans both scopes', async () => {
        registry = [
            { name: 'shared-piece', version: '1.9.0', pieceType: 'OFFICIAL' },
            { name: 'shared-piece', version: '1.2.0', pieceType: 'CUSTOM', platformId: OFFICIAL_PLATFORM },
        ]
        dbRows = [
            { id: 'row-official', name: 'shared-piece', version: '1.9.0', pieceType: 'OFFICIAL', platformId: undefined, packageType: 'REGISTRY' },
            { id: 'row-platform', name: 'shared-piece', version: '1.2.0', pieceType: 'CUSTOM', platformId: OFFICIAL_PLATFORM, packageType: 'ARCHIVE', archiveId: 'arch-1' },
        ]

        const service = await loadService()
        const result = await service.get({ name: 'shared-piece', version: '^1.0.0', platformId: OFFICIAL_PLATFORM })

        expect(result?.id).toBe('row-platform')
    })

    it('still resolves the official piece when the platform has no same-name piece', async () => {
        registry = [
            { name: 'official-only', version: '2.1.0', pieceType: 'OFFICIAL' },
        ]
        dbRows = [
            { id: 'row-official', name: 'official-only', version: '2.1.0', pieceType: 'OFFICIAL', platformId: undefined, packageType: 'REGISTRY' },
        ]

        const service = await loadService()
        const result = await service.get({ name: 'official-only', version: undefined, platformId: OFFICIAL_PLATFORM })

        expect(result?.id).toBe('row-official')
    })

    it('resolves the official piece when an exact version pin only matches it', async () => {
        registry = [
            { name: 'shared-piece', version: '2.1.0', pieceType: 'OFFICIAL' },
            { name: 'shared-piece', version: '0.3.0', pieceType: 'CUSTOM', platformId: OFFICIAL_PLATFORM },
        ]
        dbRows = [
            { id: 'row-official', name: 'shared-piece', version: '2.1.0', pieceType: 'OFFICIAL', platformId: undefined, packageType: 'REGISTRY' },
            { id: 'row-platform', name: 'shared-piece', version: '0.3.0', pieceType: 'CUSTOM', platformId: OFFICIAL_PLATFORM, packageType: 'ARCHIVE', archiveId: 'arch-1' },
        ]

        const service = await loadService()
        const result = await service.get({ name: 'shared-piece', version: '2.1.0', platformId: OFFICIAL_PLATFORM })

        expect(result?.id).toBe('row-official')
    })

    it('never resolves another platform\'s custom piece', async () => {
        registry = [
            { name: 'shared-piece', version: '2.1.0', pieceType: 'OFFICIAL' },
            { name: 'shared-piece', version: '0.3.0', pieceType: 'CUSTOM', platformId: 'other-platform' },
        ]
        dbRows = [
            { id: 'row-official', name: 'shared-piece', version: '2.1.0', pieceType: 'OFFICIAL', platformId: undefined, packageType: 'REGISTRY' },
            { id: 'row-other', name: 'shared-piece', version: '0.3.0', pieceType: 'CUSTOM', platformId: 'other-platform', packageType: 'ARCHIVE', archiveId: 'arch-other' },
        ]

        const service = await loadService()
        const result = await service.get({ name: 'shared-piece', version: undefined, platformId: OFFICIAL_PLATFORM })

        expect(result?.id).toBe('row-official')
    })
})
