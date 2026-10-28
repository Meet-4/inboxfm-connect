import { beforeEach, describe, expect, it, vi } from 'vitest'

// PK-rotation regression: update() used repository.upsert() with a fresh apId()
// per call and a (projectId, fieldId, recordId) conflict target. TypeORM's
// repository.upsert() puts every supplied non-conflict column into
// ON CONFLICT ... DO UPDATE SET, so every record update rewrote the cell row's
// primary key. The fix builds the insert with an explicit overwrite list
// (['value']) — same shape as store-entry — so `id` is only ever inserted,
// never updated.

const mockCellUpsert = vi.fn()
const mockCellInsert = vi.fn()
const mockCellValues = vi.fn()
const mockCellOrUpdate = vi.fn()
const mockCellExecute = vi.fn()
const mockRecordFindOne = vi.fn()
const mockFieldFind = vi.fn()

const cellInsertBuilder = {
    insert: mockCellInsert,
    values: mockCellValues,
    orUpdate: mockCellOrUpdate,
    execute: mockCellExecute,
}

const mockEntityManager = {
    getRepository: vi.fn((entity: { options?: { name?: string } }) => {
        switch (entity.options?.name) {
            case 'record':
                return { findOne: mockRecordFindOne }
            case 'field':
                return { find: mockFieldFind }
            case 'cell':
                return {
                    upsert: mockCellUpsert,
                    createQueryBuilder: () => cellInsertBuilder,
                }
            default:
                throw new Error(`unexpected entity in test: ${entity?.options?.name}`)
        }
    }),
}

vi.mock('../../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: () => () => ({}),
}))

vi.mock('../../../../../src/app/core/db/transaction', () => ({
    transaction: async (fn: (em: unknown) => Promise<unknown>) => fn(mockEntityManager),
}))

vi.mock('../../../../../src/app/tables/field/field.service', () => ({
    fieldService: {
        getAll: vi.fn(async () => [{ id: 'field_1', name: 'Name' }]),
        getAllByTableIds: vi.fn(async () => new Map()),
    },
}))

beforeEach(() => {
    vi.clearAllMocks()
    mockCellInsert.mockReturnValue(cellInsertBuilder)
    mockCellValues.mockReturnValue(cellInsertBuilder)
    mockCellOrUpdate.mockReturnValue(cellInsertBuilder)
    mockCellExecute.mockResolvedValue(undefined)
})

const { recordService } = await import('../../../../../src/app/tables/record/record.service')

const record = {
    id: 'rec_1',
    tableId: 'tbl_1',
    projectId: 'proj_1',
    cells: [],
    created: '2024-01-01T00:00:00.000Z',
    updated: '2024-01-01T00:00:00.000Z',
}

const updatedRecord = {
    ...record,
    cells: [{ fieldId: 'field_1', value: 'new value', created: '2024-01-01T00:00:00.000Z', updated: '2024-01-01T00:00:00.000Z' }],
}

describe('recordService.update cell upsert (unit)', () => {
    it('upserts cells with an explicit overwrite list so the cell primary key is never rewritten', async () => {
        mockRecordFindOne
            .mockResolvedValueOnce(record)
            .mockResolvedValueOnce(updatedRecord)
        mockFieldFind.mockResolvedValue([{ id: 'field_1', name: 'Name' }])

        await recordService.update({
            id: 'rec_1',
            projectId: 'proj_1',
            request: {
                tableId: 'tbl_1',
                cells: [{ fieldId: 'field_1', value: 'new value' }],
            },
        })

        expect(mockCellUpsert).not.toHaveBeenCalled()
        expect(mockCellInsert).toHaveBeenCalled()
        expect(mockCellValues).toHaveBeenCalledWith([
            expect.objectContaining({
                recordId: 'rec_1',
                fieldId: 'field_1',
                projectId: 'proj_1',
                value: 'new value',
                id: expect.any(String),
            }),
        ])
        expect(mockCellOrUpdate).toHaveBeenCalledWith(['value'], ['projectId', 'fieldId', 'recordId'])
        expect(mockCellExecute).toHaveBeenCalled()
    })

    it('does not touch cells when the request carries none', async () => {
        mockRecordFindOne
            .mockResolvedValueOnce(record)
            .mockResolvedValueOnce(record)

        await recordService.update({
            id: 'rec_1',
            projectId: 'proj_1',
            request: { tableId: 'tbl_1', cells: [] },
        })

        expect(mockCellInsert).not.toHaveBeenCalled()
        expect(mockCellUpsert).not.toHaveBeenCalled()
    })
})
