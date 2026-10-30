import { describe, it, expect, vi, beforeEach } from 'vitest'
import { onCallService, OnCallPagePayload } from '../src/on-call.service'
import { safeHttp } from '../src/safe-http'
import { DatabaseType } from '../src/database-type'
import { RedisType } from '../src/redis-type'

describe('onCallService', () => {
    const mockLogger = {
        error: vi.fn(),
    }

    const testPayload: OnCallPagePayload = {
        code: 'ENGINE_FAILURE',
        message: 'Sandbox process exited unexpectedly',
        params: { sandboxId: 'sbx_123', exitCode: 137 },
    }

    beforeEach(() => {
        vi.restoreAllMocks()
        mockLogger.error.mockClear()
    })

    it('should do nothing and not log error when webhookUrl is undefined', async () => {
        const requestSpy = vi.spyOn(safeHttp.axios, 'request')
        const service = onCallService(mockLogger, undefined)

        await service.page(testPayload)

        expect(requestSpy).not.toHaveBeenCalled()
        expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('should do nothing and not log error when webhookUrl is empty string', async () => {
        const requestSpy = vi.spyOn(safeHttp.axios, 'request')
        const service = onCallService(mockLogger, '')

        await service.page(testPayload)

        expect(requestSpy).not.toHaveBeenCalled()
        expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('should send POST request with payload when webhookUrl is provided', async () => {
        const webhookUrl = 'https://alerts.example.com/oncall-webhook'
        const requestSpy = vi.spyOn(safeHttp.axios, 'request').mockResolvedValue({
            status: 200,
            data: { received: true },
        } as never)

        const service = onCallService(mockLogger, webhookUrl)
        await service.page(testPayload)

        expect(requestSpy).toHaveBeenCalledTimes(1)
        expect(requestSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                url: webhookUrl,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                data: {
                    code: testPayload.code,
                    message: testPayload.message,
                    params: testPayload.params,
                },
            }),
        )
        expect(mockLogger.error).not.toHaveBeenCalled()
    })

    it('should catch fetch error and log it without rethrowing', async () => {
        const webhookUrl = 'https://alerts.example.com/oncall-webhook'
        const networkError = new Error('Connection refused')
        vi.spyOn(safeHttp.axios, 'request').mockRejectedValue(networkError)

        const service = onCallService(mockLogger, webhookUrl)

        await expect(service.page(testPayload)).resolves.toBeUndefined()

        expect(mockLogger.error).toHaveBeenCalledTimes(1)
        expect(mockLogger.error).toHaveBeenCalledWith(
            { fetchError: networkError },
            'Failed to send on-call page',
        )
    })

    it('should log an error when the webhook endpoint rejects the page with HTTP 500', async () => {
        // validateStatus: () => true means non-2xx responses resolve instead of
        // throwing — silently treating a rejected page as delivered defeats the
        // entire purpose of on-call paging.
        const webhookUrl = 'https://alerts.example.com/oncall-webhook'
        vi.spyOn(safeHttp.axios, 'request').mockResolvedValue({
            status: 500,
            data: 'Internal Server Error',
        } as never)

        const service = onCallService(mockLogger, webhookUrl)
        await expect(service.page(testPayload)).resolves.toBeUndefined()

        expect(mockLogger.error).toHaveBeenCalledTimes(1)
        const [errorObj, message] = mockLogger.error.mock.calls[0]
        expect((errorObj as Record<string, unknown>)['status']).toBe(500)
        expect(message).toContain('Failed to send on-call page')
    })

    it('should log an error when the webhook endpoint returns 404 (misconfigured URL)', async () => {
        const webhookUrl = 'https://alerts.example.com/oncall-webhook'
        vi.spyOn(safeHttp.axios, 'request').mockResolvedValue({
            status: 404,
            data: 'Not Found',
        } as never)

        const service = onCallService(mockLogger, webhookUrl)
        await expect(service.page(testPayload)).resolves.toBeUndefined()

        expect(mockLogger.error).toHaveBeenCalledTimes(1)
        expect((mockLogger.error.mock.calls[0][0] as Record<string, unknown>)['status']).toBe(404)
    })

    it('should not log an error on a 204 No Content response', async () => {
        const webhookUrl = 'https://alerts.example.com/oncall-webhook'
        vi.spyOn(safeHttp.axios, 'request').mockResolvedValue({
            status: 204,
            data: '',
        } as never)

        const service = onCallService(mockLogger, webhookUrl)
        await expect(service.page(testPayload)).resolves.toBeUndefined()

        expect(mockLogger.error).not.toHaveBeenCalled()
    })
})

describe('DatabaseType and RedisType driver enums', () => {
    it('should export expected database driver types', () => {
        expect(DatabaseType.POSTGRES).toBe('POSTGRES')
        expect(DatabaseType.PGLITE).toBe('PGLITE')
    })

    it('should export expected redis driver types', () => {
        expect(RedisType.SENTINEL).toBe('SENTINEL')
        expect(RedisType.MEMORY).toBe('MEMORY')
        expect(RedisType.STANDALONE).toBe('STANDALONE')
    })
})
