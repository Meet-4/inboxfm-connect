import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApLogger } from '@inboxfm-connect/server-utils'
import { PackageType, PieceType } from '@inboxfm-connect/shared'
import type { OfficialPiecePackage } from '@inboxfm-connect/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pieceInstaller } from '../../../../src/lib/cache/pieces/piece-installer'

// The cached bundle.tgz is the piece cache's source of truth and the
// "already cached" gate is a bare fileExists check — a bundle.tgz that is
// partially written (process crash mid-write) would be served as a valid
// cache hit forever. These tests pin the atomic write that prevents it.

// While true, the mocked fs writeFile writes partial bytes to the .tmp
// bundle file and then throws — simulating a crash mid-write.
let crashNextBundleWrite = false

vi.mock('node:fs/promises', async (importActual) => {
    const actual = await importActual<typeof import('node:fs/promises')>()
    return {
        ...actual,
        writeFile: async (path: unknown, data: unknown, options: unknown) => {
            if (crashNextBundleWrite && path.toString().endsWith('.tmp')) {
                await actual.writeFile(path, 'corrupt-partial-tarball')
                throw new Error('simulated crash mid-write')
            }
            return actual.writeFile(path, data, options)
        },
    }
})

const mockInstall = vi.fn()

vi.mock('../../../../src/lib/utils/bun-runner', () => ({
    bunRunner: () => ({
        install: mockInstall,
    }),
}))

let testWorkspace = ''

vi.mock('../../../../src/lib/cache/cache-paths', () => ({
    cacheUtils: () => ({
        getGlobalCacheCommonPath: () => testWorkspace,
        getGlobalCachePathLatestVersion: () => testWorkspace,
    }),
}))

function makePiece(name: string, version = '1.0.0'): OfficialPiecePackage {
    return {
        packageType: PackageType.REGISTRY,
        pieceType: PieceType.OFFICIAL,
        pieceName: name,
        pieceVersion: version,
    }
}

function pieceDirPath(piece: OfficialPiecePackage): string {
    return join(testWorkspace, 'pieces', `${piece.pieceName}-${piece.pieceVersion}`)
}

function bundleTgzPath(piece: OfficialPiecePackage): string {
    return join(pieceDirPath(piece), 'bundle.tgz')
}

async function pathExists(p: string): Promise<boolean> {
    const { access } = await import('node:fs/promises')
    return access(p).then(() => true, () => false)
}

async function tempFilesInPieceDir(piece: OfficialPiecePackage): Promise<string[]> {
    const dir = pieceDirPath(piece)
    if (!await pathExists(dir)) {
        return []
    }
    const entries = await readdir(dir)
    return entries.filter((entry) => entry.endsWith('.tmp'))
}

const fakeLog = {
    level: 'silent',
    silent: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn().mockReturnThis(),
} as unknown as ApLogger

const bundleSource = { publicApiUrl: 'http://localhost:3000/api/', engineToken: 'test-token' }

const fakeGetSettings = () => ({
    EXECUTION_MODE: 'UNSANDBOXED',
    DEV_PIECES: [] as string[],
    ENVIRONMENT: 'production',
    REUSE_SANDBOX: undefined,
    FLOW_TIMEOUT_SECONDS: 600,
    MAX_FILE_SIZE_MB: 10,
    MAX_FLOW_RUN_LOG_SIZE_MB: 10,
    NETWORK_MODE: 'UNRESTRICTED' as never,
    SANDBOX_MEMORY_LIMIT: '1048576',
    SANDBOX_PROPAGATED_ENV_VARS: [] as string[],
    SSRF_ALLOW_LIST: [] as string[],
})

beforeEach(async () => {
    testWorkspace = join(tmpdir(), `piece-installer-atomic-test-${randomUUID()}`)
    await mkdir(testWorkspace, { recursive: true })
    vi.clearAllMocks()
    crashNextBundleWrite = false
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('tgz-bytes').buffer,
    }))
})

afterEach(async () => {
    crashNextBundleWrite = false
    vi.unstubAllGlobals()
    await rm(testWorkspace, { recursive: true, force: true })
})

describe('pieceInstaller bundle.tgz atomic write', () => {
    it('stores the fetched tarball at bundle.tgz with no temp residue on success', async () => {
        const piece = makePiece('@inboxfm-connect/piece-atomic-ok')
        const installer = pieceInstaller(fakeLog, testWorkspace, fakeGetSettings)
        mockInstall.mockResolvedValueOnce({ output: '' })

        await installer.install({ pieces: [piece], includeFilters: true, ...bundleSource })

        expect(await pathExists(bundleTgzPath(piece))).toBe(true)
        expect(await readFile(bundleTgzPath(piece), 'utf8')).toBe('tgz-bytes')
        expect(await tempFilesInPieceDir(piece)).toEqual([])
        expect(await pathExists(join(pieceDirPath(piece), 'ready'))).toBe(true)
    })

    it('a crash mid-write leaves no corrupt bundle.tgz — the cache is not poisoned', async () => {
        const piece = makePiece('@inboxfm-connect/piece-atomic-crash')
        const installer = pieceInstaller(fakeLog, testWorkspace, fakeGetSettings)
        crashNextBundleWrite = true

        await expect(installer.install({ pieces: [piece], includeFilters: true, ...bundleSource }))
            .rejects.toThrow('simulated crash mid-write')

        expect(await pathExists(bundleTgzPath(piece))).toBe(false)
        expect(await tempFilesInPieceDir(piece)).toEqual([])
        expect(mockInstall).not.toHaveBeenCalled()
    })

    it('a crashed install self-heals on the next attempt instead of serving a corrupt tarball forever', async () => {
        const piece = makePiece('@inboxfm-connect/piece-atomic-retry')
        const installer = pieceInstaller(fakeLog, testWorkspace, fakeGetSettings)

        crashNextBundleWrite = true
        await expect(installer.install({ pieces: [piece], includeFilters: true, ...bundleSource }))
            .rejects.toThrow('simulated crash mid-write')

        crashNextBundleWrite = false
        mockInstall.mockResolvedValueOnce({ output: '' })
        await installer.install({ pieces: [piece], includeFilters: true, ...bundleSource })

        expect(mockInstall).toHaveBeenCalledOnce()
        expect(await readFile(bundleTgzPath(piece), 'utf8')).toBe('tgz-bytes')
        expect(await pathExists(join(pieceDirPath(piece), 'ready'))).toBe(true)
    })
})
