import { Mutex } from 'async-mutex'
import fastify from 'fastify'
import dayjs from 'dayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { StripeCheckoutType } from '../../../../../src/app/ee/platform/platform-plan/stripe-helper'

// Companion regression to platform-ai-credits-limit-update-race.test.ts.
//
// The admin console's one-time credit grant (POST /platforms/increase-ai-credits
// → adminPlatformService.increaseAiCredits) used to inline the same unlocked
// read-modify-write on the platform's managed OpenRouter key:
//
//     getKey()  ->  limit: key.limit + amount  ->  updateKey()
//
// OpenRouter's updateKey takes the full ABSOLUTE limit, so an admin grant
// racing a Stripe payment webhook (or the monthly renewal job) had both
// paths read the same limit and each PATCH its own incremented value — the
// later write silently erased the earlier increment, and paid credits
// vanished. The grant also never dropped the `openrouter_usage_*` cache, so
// getUsage kept serving the pre-grant balance for up to
// USAGE_CACHE_TTL_SECONDS.
//
// The fix routes the admin grant through addOpenRouterKeyLimit, the same
// locked read-modify-write + usage-cache invalidation every other top-up path
// uses.

const mockFindOneBy = vi.fn()
const mockFindOneByOrFail = vi.fn()
const mockExistsBy = vi.fn()
const mockSave = vi.fn()

const mockGetKey = vi.fn()
const mockUpdateKey = vi.fn()
const mockCreateKey = vi.fn()

const mockStoreGet = vi.fn()
const mockStorePut = vi.fn()
const mockStoreDelete = vi.fn()

const mockPlanGetOrCreate = vi.fn()
const mockPlanUpdate = vi.fn()

const mockUpsertJob = vi.fn()
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
    // jwt-utils / encryption read the redis type at module scope; nothing in
    // the tested path talks to real Redis.
    redisConnections: {
        getRedisType: () => 'MEMORY',
        create: vi.fn(async () => null),
        useExisting: vi.fn(async () => null),
    },
    distributedLock: () => ({ runExclusive: mockLock }),
    distributedStore: {
        get: mockStoreGet,
        put: mockStorePut,
        delete: mockStoreDelete,
        incr: vi.fn(async () => 1),
        putIfAbsent: vi.fn(async () => true),
    },
}))

vi.mock('../../../../../src/app/helper/encryption', () => ({
    // ai-provider-entity imports EncryptedObject (a zod schema) at module
    // scope, so the mock must expose it alongside the encrypt/decrypt methods.
    EncryptedObject: z.object({ iv: z.string(), data: z.string() }),
    EncryptedString: z.string(),
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
        getKey: mockGetKey,
        updateKey: mockUpdateKey,
    },
}))

vi.mock('../../../../../src/app/ee/platform/platform-plan/platform-plan.service', () => ({
    ACTIVE_FLOW_PRICE_ID: 'price_123',
    platformPlanService: () => ({
        getOrCreateForPlatform: mockPlanGetOrCreate,
        update: mockPlanUpdate,
    }),
}))

vi.mock('../../../../../src/app/flags/flag.service', () => ({
    // flag.service drags the platform/user service graph through the email
    // sender; nothing in the tested path reads flags.
    flagService: () => ({ aiCreditsEnabled: () => true }),
}))

vi.mock('../../../../../src/app/helper/system-jobs/system-job', () => ({
    systemJobsSchedule: () => ({ upsertJob: mockUpsertJob }),
}))

vi.mock('../../../../../src/app/helper/system-jobs/job-handlers', () => ({
    systemJobHandlers: { registerJobHandler: vi.fn() },
}))

// admin-platform.service's own module-scope imports. Only increaseAiCredits'
// dependency chain runs here; the identity/license functions are never
// invoked by this test.
vi.mock('../../../../../src/app/authentication/user-identity/user-identity-service', () => ({
    userIdentityService: () => ({ getIdentityByEmail: vi.fn() }),
}))
vi.mock('../../../../../src/app/platform/platform.service', () => ({
    platformRepo: () => ({ findOneBy: vi.fn(), findOneByOrFail: vi.fn(), save: vi.fn() }),
}))
vi.mock('../../../../../src/app/user/user-service', () => ({
    userRepo: () => ({ findOneBy: vi.fn(), findOneByOrFail: vi.fn(), save: vi.fn() }),
}))
vi.mock('../../../../../src/app/ee/license-keys/license-keys-service', () => ({
    licenseKeysService: () => ({ verifyKeyOrReturnNull: vi.fn(), applyLimits: vi.fn() }),
}))

const logger = fastify({ logger: false }).log

const { platformAiCreditsService } = await import('../../../../../src/app/ee/platform/platform-plan/platform-ai-credits.service')
const { adminPlatformService } = await import('../../../../../src/app/ee/platform/admin/admin-platform.service')

// In-process stand-in for the RedLock semantics of distributedLock: mutual
// exclusion per key, second caller waits for the first to fully settle.
const mutexes = new Map<string, Mutex>()
async function mutexRunExclusive<T>({ key, fn }: { key: string, fn: () => Promise<T> }): Promise<T> {
    const mutex = mutexes.get(key) ?? new Mutex()
    mutexes.set(key, mutex)
    return mutex.runExclusive(async () => fn())
}

const providerRow = {
    id: 'ap_provider',
    platformId: 'platform-a',
    provider: 'ACTIVEPIECES',
    displayName: 'Inboxfm Connect',
    auth: { apiKey: '«reda...…»', apiKeyHash: 'hash-1' },
    config: {},
    enabledForChat: true,
}

// Stateful OpenRouter key: `limit` lives here exactly like it does on the
// remote key — updateKey overwrites the whole absolute value.
let keyLimit = 10

describe('adminPlatformService.increaseAiCredits managed-key limit mutation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mutexes.clear()
        keyLimit = 10
        mockLock.mockImplementation(mutexRunExclusive)
        mockFindOneBy.mockImplementation(async () => providerRow)
        mockFindOneByOrFail.mockImplementation(async () => providerRow)
        mockExistsBy.mockResolvedValue(true)
        // A short delay inside getKey widens the read window so an unlocked
        // read-modify-write demonstrably reads the same limit twice.
        mockGetKey.mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 5))
            return {
                data: {
                    hash: 'hash-1',
                    limit: keyLimit,
                    limit_remaining: keyLimit,
                    usage: 0,
                    usage_monthly: 0,
                },
            }
        })
        mockUpdateKey.mockImplementation(async (request: { limit: number }) => {
            await new Promise(resolve => setTimeout(resolve, 1))
            keyLimit = request.limit
            return { data: { hash: 'hash-1', limit: request.limit } }
        })
        mockStoreGet.mockResolvedValue(null)
        mockStorePut.mockResolvedValue(undefined)
        mockStoreDelete.mockResolvedValue(undefined)
        mockUpsertJob.mockResolvedValue(undefined)
        mockPlanGetOrCreate.mockResolvedValue({
            platformId: 'platform-a',
            includedAiCredits: 1000,
            lastFreeAiCreditsRenewalDate: dayjs().subtract(2, 'month').toISOString(),
            aiCreditsAutoTopUpState: 'DISABLED',
            stripeCustomerId: 'cus_1',
        })
    })

    it('serializes the admin console credit grant against a racing Stripe top-up', async () => {
        await Promise.all([
            adminPlatformService(logger).increaseAiCredits({ platformId: 'platform-a', amountInUsd: 7 }),
            platformAiCreditsService(logger).aiCreditsPaymentSucceeded('platform-a', 5, StripeCheckoutType.AI_CREDIT_PAYMENT),
        ])

        // Both increments must survive: 10 + 7 (admin grant) + 5 (webhook) = 22.
        // Unlocked, both reads see 10 and the later PATCH erases the other
        // increment (final 17 or 15 — paid credits vanish).
        expect(keyLimit).toBe(22)
        // The admin grant also drops the stale usage cache, which the inline
        // read-modify-write it replaced never did.
        expect(mockStoreDelete).toHaveBeenCalledWith('openrouter_usage_hash-1')
    })
})
