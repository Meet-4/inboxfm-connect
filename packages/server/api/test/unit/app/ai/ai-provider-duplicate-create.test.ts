import { ActivepiecesError, AIProviderName, ErrorCode } from '@inboxfm-connect/core-utils'
import { CreateAIProviderRequest } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSave, mockEncryptObject, mockValidateConnection } = vi.hoisted(() => ({
    mockSave: vi.fn(),
    mockEncryptObject: vi.fn(),
    mockValidateConnection: vi.fn(),
}))

vi.mock('../../../../src/app/core/db/repo-factory', () => ({
    repoFactory: (): () => { save: typeof mockSave } => () => ({
        save: mockSave,
    }),
}))

vi.mock('../../../../src/app/helper/encryption', () => ({
    encryptUtils: {
        encryptObject: mockEncryptObject,
    },
}))

vi.mock('../../../../src/app/ai/ai-provider-entity', () => ({
    AIProviderEntity: {},
}))

vi.mock('../../../../src/app/ai/providers', () => ({
    aiProviders: {
        openai: {
            name: 'OpenAI',
            validateConnection: mockValidateConnection,
        },
    },
}))

import { aiProviderService } from '../../../../src/app/ai/ai-provider-service'

const mockLog: FastifyBaseLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

const request: CreateAIProviderRequest = {
    displayName: 'My OpenAI',
    provider: AIProviderName.OPENAI,
    auth: { apiKey: 'test-key' },
    config: {},
}

describe('aiProviderService.create() duplicate-provider handling (#545)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockEncryptObject.mockResolvedValue({ iv: 'test-iv', data: 'test-data' })
        mockValidateConnection.mockResolvedValue(undefined)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it.each([
        ['top-level code (pg shape)', Object.assign(new Error('duplicate key value violates unique constraint "idx_ai_provider_platform_id_provider"'), { code: '23505' })],
        ['driverError.code (PGLite shape — the shape the integration suite runs)', Object.assign(new Error('duplicate key value violates unique constraint "idx_ai_provider_platform_id_provider"'), { driverError: { code: '23505' } })],
    ])('a duplicate create (%s) is a 409-mapped conflict error, not a leaked driver 500', async (_label, violation) => {
        mockSave.mockRejectedValueOnce(violation)

        const service = aiProviderService(mockLog)

        let caught: unknown
        try {
            await service.create('platform-1', request)
        }
        catch (err) {
            caught = err
        }

        expect(caught).toBeInstanceOf(ActivepiecesError)
        const apError = caught as ActivepiecesError<{ message: string }>
        // VALIDATION is the API error handler's 409 CONFLICT mapping: the caller
        // learns the provider already exists instead of a raw driver 500.
        expect(apError.error.code).toBe(ErrorCode.VALIDATION)
        expect(apError.error.params.message).toBe(`AI provider of type "${AIProviderName.OPENAI}" already exists for this platform`)
        // The raw driver payload — SQLSTATE and constraint name included — never
        // reaches the client through the mapped error.
        expect(JSON.stringify(apError.error)).not.toContain('23505')
        expect(JSON.stringify(apError.error)).not.toContain('idx_ai_provider_platform_id_provider')
    })

    it('a non-unique save failure propagates raw instead of masquerading as a conflict', async () => {
        mockSave.mockRejectedValueOnce(new Error('connection refused'))

        const service = aiProviderService(mockLog)

        await expect(service.create('platform-1', request)).rejects.toThrow('connection refused')
    })

    it('a first create saves the provider row and resolves', async () => {
        mockSave.mockResolvedValueOnce(undefined)

        const service = aiProviderService(mockLog)

        await expect(service.create('platform-1', request)).resolves.toBeUndefined()
        expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({
            platformId: 'platform-1',
            provider: AIProviderName.OPENAI,
            displayName: 'My OpenAI',
        }))
        expect(mockValidateConnection).toHaveBeenCalledOnce()
    })
})
