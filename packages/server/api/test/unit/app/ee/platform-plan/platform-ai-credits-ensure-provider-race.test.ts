import fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Race regression: ensureActivepiecesProvider was an unlocked find-then-save
// on the ai_provider (platformId, provider) unique index. Its callers — the
// Stripe billing webhooks (aiCreditsPaymentSucceeded) and the admin top-up
// route (increaseAiCredits) — fire concurrently on a fresh platform, so the
// loser surfaced a raw QueryFailedError 23505 as an HTTP 500 and failed the
// payment webhook. Worse, even after a converged ensure, two callers could
// both read the still-empty auth and each mint an OpenRouter key, leaking
// the loser's paid key.
//
// The fix runs the whole ensure + mint under the same provision mutex the CE
// ai-provider-service uses for its auto-create ('ai-provider:provision:<platformId>'),
// with the in-lock re-check arbitrating and a lost save converging on the
// winner's row (unique-violation detection), instead of throwing.

const mockFindOneBy = vi.fn()
const mockFindOneByOrFail = vi.fn()
const mockExistsBy = vi.fn()
const mockSave = vi.fn()

const mockCreateKey = vi.fn()

const mockPlanUpdate = vi.fn()

const mockLock = vi.fn()

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({
        findOneBy: mockFindOneBy,
        findOneByOrFail: mockFindOneByOrFail,
        existsBy: mockExistsBy,
        save: mockSave,
    }),
}))

vi.mock('../../../../../src/app/database/redis-connections', () => ({
    // jwt-utils / encryption read the redis type at module scope; nothing in the
    // tested path talks to Redis.
    redisConnections: {
        getRedisType: () => 'MEMORY',
        create: vi.fn(async () => null),
        useExisting: vi.fn(async () => null),
    },
    distributedLock: () => ({ runExclusive: mockLock }),
    distributedStore: {
        get: vi.fn(async () => null),
        put: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        incr: vi.fn(async () => 1),
        putIfAbsent: vi.fn(async () => true),
    },
}))

vi.mock('../../../../../src/app/helper/encryption', () => ({
    encryptUtils: {
        encryptObject: async (object: unknown) => object,
        decryptObject: async (object: unknown) => object,
        encryptString: async (value: string) => value,
        decryptString: async (value: string) => value,
    },
}))

vi.mock('../../../../../src/app/ee/platform/platform-plan/openrouter/openrouter-api', () => ({
    openRouterApi: {
        createKey: mockCreateKey,
        getKey: vi.fn(),
        updateKey: vi.fn(),
    },
}))

vi.mock('../../../../../src/app/ee/platform/platform-plan/platform-plan.service', () => ({
    ACTIVE_FLOW_PRICE_ID: 'price_123',
    platformPlanService: () => ({
        getOrCreateForPlatform: async () => ({ plan: 'standard', platformId: 'platform-a', includedAiCredits: 1000 }),
        update: mockPlanUpdate,
    }),
}))

vi.mock('../../../../../src/app/flags/flag.service', () => ({
    // flag.service drags the platform/user service graph through the email
    // sender; nothing in the tested path reads flags.
    flagService: () => ({ aiCreditsEnabled: () => true }),
}))

vi.mock('../../../../../src/app/helper/system-jobs/system-job', () => ({
    systemJobsSchedule: () => ({ upsertJob: vi.fn(async () => {}) }),
}))

vi.mock('../../../../../src/app/helper/system-jobs/job-handlers', () => ({
    systemJobHandlers: { registerJobHandler: vi.fn() },
}))

const logger = fastify({ logger: false }).log

const { platformAiCreditsService } = await import('../../../../../src/app/ee/platform/platform-plan/platform-ai-credits.service')

// RedLock semantics: run the caller's fn, then release.
async function realRunExclusive<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    return fn()
}

// Serializing RedLock semantics: each locked fn only starts after the previous
// one fully settled (what runExclusive guarantees with a real Redis behind it).
let lockChain: Promise<unknown> = Promise.resolve()
async function serializingRunExclusive<T>({ fn }: { fn: () => Promise<T> }): Promise<T> {
    const run = lockChain.then(() => fn())
    lockChain = run.then(() => undefined, () => undefined)
    return run
}

const winnerRow = {
    id: 'ap_winner',
    platformId: 'platform-a',
    provider: 'ACTIVEPIECES',
    displayName: 'Inboxfm Connect',
    auth: { apiKey: 'key-existing', apiKeyHash: 'hash-existing' },
    config: {},
    enabledForChat: true,
}

describe('platformAiCreditsService.getOrCreateActivePiecesProviderAuthConfig race', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockLock.mockImplementation(realRunExclusive)
        lockChain = Promise.resolve()
    })

    it('serializes the ensure + mint under the shared ai-provider provision lock and mints one key for two concurrent callers', async () => {
        // Stateful repo: the row does not exist until the first save lands.
        let providerRow: unknown = null
        mockFindOneBy.mockImplementation(async () => providerRow)
        mockFindOneByOrFail.mockImplementation(async () => {
            if (providerRow === null) {
                throw new Error('provider row not found')
            }
            return providerRow
        })
        mockExistsBy.mockResolvedValue(false)
        mockSave.mockImplementation(async (row: unknown) => {
            providerRow = row
            return row
        })
        mockCreateKey.mockResolvedValue({ key: 'key-1', data: { hash: 'hash-1' } })
        mockLock.mockImplementation(serializingRunExclusive)

        const [first, second] = await Promise.all([
            platformAiCreditsService(logger).getOrCreateActivePiecesProviderAuthConfig({ platformId: 'platform-a' }),
            platformAiCreditsService(logger).getOrCreateActivePiecesProviderAuthConfig({ platformId: 'platform-a' }),
        ])

        // Same mutex as the CE ai-provider-service auto-create and chat assignment.
        expect(mockLock).toHaveBeenCalledWith(expect.objectContaining({ key: 'ai-provider:provision:platform-a' }))
        // Exactly one provider row and one OpenRouter key were minted.
        expect(mockCreateKey).toHaveBeenCalledTimes(1)
        expect(first).toEqual({ apiKey: 'key-1', apiKeyHash: 'hash-1' })
        expect(second).toEqual({ apiKey: 'key-1', apiKeyHash: 'hash-1' })
        // The renewal job is scheduled per caller.
        expect(mockPlanUpdate).toHaveBeenCalled()
    })

    it('converges on the winner row instead of surfacing a raw 23505 when a concurrent creator won the unique index', async () => {
        mockFindOneBy.mockResolvedValue(null)
        mockExistsBy.mockResolvedValue(false)
        // The lock failed open and another creator's insert won the race.
        mockSave.mockRejectedValueOnce({ code: '23505' })
        mockFindOneByOrFail.mockResolvedValue(winnerRow)
        mockCreateKey.mockResolvedValue({ key: 'should-not-mint', data: { hash: 'should-not-mint' } })

        const auth = await platformAiCreditsService(logger).getOrCreateActivePiecesProviderAuthConfig({ platformId: 'platform-a' })

        expect(auth).toEqual({ apiKey: 'key-existing', apiKeyHash: 'hash-existing' })
        // The winner already minted its key — no second OpenRouter key.
        expect(mockCreateKey).not.toHaveBeenCalled()
    })

    it('propagates a save failure that is not a unique-index violation', async () => {
        mockFindOneBy.mockResolvedValue(null)
        mockExistsBy.mockResolvedValue(false)
        mockSave.mockRejectedValueOnce(new Error('db is on fire'))

        await expect(platformAiCreditsService(logger).getOrCreateActivePiecesProviderAuthConfig({ platformId: 'platform-a' }))
            .rejects
            .toThrow('db is on fire')
        expect(mockCreateKey).not.toHaveBeenCalled()
    })
})
