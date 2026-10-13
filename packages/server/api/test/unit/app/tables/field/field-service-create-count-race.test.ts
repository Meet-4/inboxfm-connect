import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { FieldType } from '@inboxfm-connect/shared'

// Harness: the count mock is backed by `committedFields`, which the save mock
// commits into, so a check-then-act race between two creates is observable
// in-process — with a correctly serialized service the second create's count
// read must observe the first create's commit.

let committedFields: Array<Record<string, unknown>> = []
let maxFieldsPerTable = 10

const mockCount = vi.fn(async () => {
    events.push('count')
    return committedFields.length
})
const mockSave = vi.fn(async (field: Record<string, unknown>) => {
    events.push('save')
    committedFields.push(field)
    return field
})

const mockQueryBuilder = {
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    execute: vi.fn(async () => undefined),
}

const mockRepo = {
    count: mockCount,
    save: mockSave,
    find: vi.fn(async () => []),
    findOne: vi.fn(async () => null),
    findOneBy: vi.fn(async () => null),
    delete: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    createQueryBuilder: vi.fn(() => mockQueryBuilder),
}

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => mockRepo,
}))

vi.mock('../../../../../src/app/core/db/transaction', () => ({
    transaction: async (fn: (em: unknown) => Promise<unknown>) => fn({}),
}))

vi.mock('../../../../../src/app/helper/system/system', () => ({
    system: {
        globalLogger: () => ({}),
        get: () => undefined,
        getNumberOrThrow: () => maxFieldsPerTable,
    },
}))

// `real` runs the locked fn immediately (no lock), `serializing` promise-chains
// every locked fn so each starts only after the previous one fully settled —
// what a Redis-backed runExclusive guarantees for same-key callers.
type LockMode = 'real' | 'serializing'

let lockMode: LockMode = 'real'
let lockQueue: Promise<unknown> = Promise.resolve()
const events: string[] = []

const mockRunExclusive = vi.fn(async ({ key, timeoutInSeconds, fn }: RunExclusiveParams) => {
    expect(timeoutInSeconds).toBe(30)
    events.push(`lock:${key}`)
    try {
        if (lockMode === 'serializing') {
            const run = lockQueue.then(fn)
            lockQueue = run.then(() => undefined, () => undefined)
            return await run
        }
        return await fn()
    }
    finally {
        events.push(`unlock:${key}`)
    }
})

vi.mock('../../../../../src/app/database/redis-connections', () => ({
    distributedLock: () => ({ runExclusive: mockRunExclusive }),
}))

beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
    lockMode = 'real'
    lockQueue = Promise.resolve()
    committedFields = []
    maxFieldsPerTable = 10
})

const { fieldService } = await import('../../../../../src/app/tables/field/field.service')

function createFieldRequest(tableId: string, name: string) {
    return {
        request: {
            name,
            type: FieldType.TEXT,
            tableId,
        },
        projectId: 'proj_1',
    }
}

describe('fieldService.create count check-then-act race (unit)', () => {
    it('runs the quota check and the insert inside one per-table lock', async () => {
        committedFields = [{ id: 'field_0' }]

        const created = await fieldService.create(createFieldRequest('table_1', 'new_field'))

        expect(events).toEqual([
            'lock:field-position_table_1',
            'count',
            'count',
            'save',
            'unlock:field-position_table_1',
        ])
        expect(mockSave).toHaveBeenCalledOnce()
        expect(created.name).toBe('new_field')
    })

    it('lets only one of two concurrent creates at the quota boundary land', async () => {
        lockMode = 'serializing'
        // 9 committed fields, limit 10: two concurrent single-field creates must
        // not both pass the count check — exactly one may insert.
        committedFields = Array.from({ length: 9 }, (_, i) => ({ id: `field_${i}`, position: i }))

        const results = await Promise.allSettled([
            fieldService.create(createFieldRequest('table_1', 'racing_a')),
            fieldService.create(createFieldRequest('table_1', 'racing_b')),
        ])

        const fulfilled = results.filter((r) => r.status === 'fulfilled')
        const rejected = results.filter((r) => r.status === 'rejected')

        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect(committedFields).toHaveLength(10)
        expect(mockSave).toHaveBeenCalledOnce()

        const rejection = rejected[0]?.reason as ActivepiecesError
        expect(rejection).toBeInstanceOf(ActivepiecesError)
        expect(rejection.error.code).toBe(ErrorCode.VALIDATION)
        expect(rejection.error.params.message).toBe('Max fields per table reached: 10')
    })

    it('still rejects an over-quota create with the same validation error before any insert', async () => {
        maxFieldsPerTable = 5
        committedFields = Array.from({ length: 5 }, (_, i) => ({ id: `field_${i}`, position: i }))

        await expect(fieldService.create(createFieldRequest('table_1', 'one_too_many')))
            .rejects
            .toMatchObject({
                error: {
                    code: ErrorCode.VALIDATION,
                    params: { message: 'Max fields per table reached: 5' },
                },
            })

        expect(mockSave).not.toHaveBeenCalled()
        expect(committedFields).toHaveLength(5)
    })

    it('returns the inserted field with its computed position under the quota', async () => {
        committedFields = [
            { id: 'field_0', position: 0 },
            { id: 'field_1', position: 1 },
            { id: 'field_2', position: 2 },
        ]

        const created = await fieldService.create(createFieldRequest('table_1', 'fourth'))

        expect(created.position).toBe(3)
        expect(committedFields).toHaveLength(4)
    })

    it('takes different lock keys for concurrent creates on different tables', async () => {
        lockMode = 'serializing'

        const results = await Promise.allSettled([
            fieldService.create(createFieldRequest('table_1', 'a')),
            fieldService.create(createFieldRequest('table_2', 'b')),
        ])

        expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

        const usedKeys = mockRunExclusive.mock.calls.map((call) => call[0]?.key)
        expect(usedKeys).toContain('field-position_table_1')
        expect(usedKeys).toContain('field-position_table_2')
        expect(new Set(usedKeys).size).toBe(2)
    })
})

type RunExclusiveParams = {
    key: string
    timeoutInSeconds: number
    fn: () => Promise<unknown>
}
