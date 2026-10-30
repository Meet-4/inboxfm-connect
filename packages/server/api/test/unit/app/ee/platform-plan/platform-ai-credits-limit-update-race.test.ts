import { Mutex } from 'async-mutex'
import fastify from 'fastify'
import dayjs from 'dayjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { StripeCheckoutType } from '../../../../../src/app/ee/platform/platform-plan/stripe-helper'

// Lost-update regression on the managed-AI key's ABSOLUTE limit.
//
// Every credit top-up path — the Stripe checkout.session.completed webhook,
// the Stripe invoice.paid auto-top-up webhook, the admin one-time grant, and
// the monthly included-credits renewal job — mutated the platform's single
// OpenRouter key with an unlocked read-modify-write:
//
//     getKey()  ->  limit: key.limit + amount  ->  updateKey()
//
// OpenRouter's updateKey takes the full absolute limit, so two concurrent
// paths both read the same limit and each write their own incremented value:
// the later PATCH silently erases the earlier increment. A platform buying
// credits while the renewal job runs (or while the admin grant fires) loses
// one of the increments permanently — paid credits vanish.
//
// The fix routes every limit mutation through one helper that (a) serializes
// the read-modify-write on a per-platform distributed lock and (b) drops the
// 3-minute cached usage afterwards — getUsage would otherwise keep serving
// the pre-top-up balance (grantFreeChatCredits already had to invalidate the
// cache by hand; the webhook and renewal paths never did).

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

const mockRegisterJobHandler = vi.fn()
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
    // jwt-utils / encryption read the redis type at module scope; nothing in the
    // tested path talks to real Redis.
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
    // ai-provider-entity imports EncryptedObject (a zod schema) at module scope,
    // so the mock must expose it alongside the encrypt/decrypt methods.
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
    systemJobHandlers: { registerJobHandler: mockRegisterJobHandler },
}))

const logger = fastify({ logger: false }).log

const { platformAiCreditsService } = await import('../../../../../src/app/ee/platform/platform-plan/platform-ai-credits.service')

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
    auth: { apiKey: 'sk-or-managed', apiKeyHash: 'hash-1' },
    config: {},
    enabledForChat: true,
}

// Stateful OpenRouter key: `limit` lives here exactly like it does on the
// remote key — updateKey overwrites the whole absolute value.
let keyLimit = 10

describe('platformAiCreditsService managed-key limit mutations', () => {
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

    it('does not lose a credit increment when a Stripe top-up races the admin grant', async () => {
        await Promise.all([
            platformAiCreditsService(logger).aiCreditsPaymentSucceeded('platform-a', 5, StripeCheckoutType.AI_CREDIT_PAYMENT),
            platformAiCreditsService(logger).grantFreeChatCredits({ platformId: 'platform-a', amountUsd: 3 }),
        ])

        // Both increments must survive: 10 + 5 (webhook) + 3 (grant) = 18.
        // Unlocked, both reads see 10 and the second write erases the first
        // increment (final 15 or 13 — paid credits vanish).
        expect(keyLimit).toBe(18)
    })

    it('invalidates the cached usage after a Stripe credit top-up', async () => {
        await platformAiCreditsService(logger).aiCreditsPaymentSucceeded('platform-a', 5, StripeCheckoutType.AI_CREDIT_PAYMENT)

        // getUsage serves from the `openrouter_usage_<hash>` cache for up to
        // USAGE_CACHE_TTL_SECONDS; without the delete it keeps reporting the
        // pre-top-up balance.
        expect(mockStoreDelete).toHaveBeenCalledWith('openrouter_usage_hash-1')
    })

    it('serializes the monthly included-credits renewal against the same mutex as payment top-ups', async () => {
        await platformAiCreditsService(logger).init()
        const handler = mockRegisterJobHandler.mock.calls[0]?.[1] as (job: { apiKeyHash: string, platformId: string }) => Promise<void>
        expect(handler).toBeTypeOf('function')

        await Promise.all([
            handler({ apiKeyHash: 'hash-1', platformId: 'platform-a' }),
            platformAiCreditsService(logger).aiCreditsPaymentSucceeded('platform-a', 5, StripeCheckoutType.AI_CREDIT_PAYMENT),
        ])

        // Renewal adds includedAiCredits / CREDIT_PER_DOLLAR = 1 USD; the
        // webhook adds 5. Both must survive the interleaving: 10 + 1 + 5 = 16.
        expect(keyLimit).toBe(16)
        // The renewal path also drops the stale usage cache.
        expect(mockStoreDelete).toHaveBeenCalledWith('openrouter_usage_hash-1')
        // And records the renewal date so it does not fire twice.
        expect(mockPlanUpdate).toHaveBeenCalledWith(expect.objectContaining({
            platformId: 'platform-a',
            lastFreeAiCreditsRenewalDate: expect.any(String),
        }))
    })
})
