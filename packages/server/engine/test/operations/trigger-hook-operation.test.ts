import {
    EngineGenericError,
    EngineResponseStatus,
    FlowTriggerType,
    FlowVersionState,
    PropsValidationError,
    TriggerHookType,
} from '@inboxfm-connect/shared'
import type { ExecuteTriggerOperation, FlowVersion } from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDownload } = vi.hoisted(() => ({
    mockDownload: vi.fn(),
}))
vi.mock('../../src/lib/api/engine-file-api', () => ({
    engineFileApi: {
        download: mockDownload,
        upload: vi.fn(),
    },
}))

const { mockExecuteTrigger } = vi.hoisted(() => ({
    mockExecuteTrigger: vi.fn(),
}))
vi.mock('../../src/lib/helper/trigger-helper', () => ({
    triggerHelper: {
        executeTrigger: mockExecuteTrigger,
    },
}))

import { triggerHookOperation } from '../../src/lib/operations/trigger-hook.operation'

function makeFlowVersion(): FlowVersion {
    return {
        id: 'fv-1',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        flowId: 'flow-1',
        displayName: 'Test Flow',
        trigger: {
            name: 'trigger_1',
            valid: true,
            displayName: 'Test Trigger',
            type: FlowTriggerType.EMPTY,
            settings: {},
        },
        updatedBy: null,
        valid: true,
        state: FlowVersionState.DRAFT,
        schemaVersion: null,
        connectionIds: [],
        agentIds: [],
    } as unknown as FlowVersion
}

function makeOperation(triggerPayload: ExecuteTriggerOperation<TriggerHookType.RUN>['triggerPayload']): ExecuteTriggerOperation<TriggerHookType.RUN> {
    return {
        hookType: TriggerHookType.RUN,
        test: false,
        flowVersion: makeFlowVersion(),
        webhookUrl: 'http://localhost:4200/webhook',
        triggerPayload,
        projectId: 'project-1',
        platformId: 'platform-1',
        engineToken: 'test-token',
        internalApiUrl: 'http://localhost:3000/',
        publicApiUrl: 'http://localhost:4200/api/',
        timeoutInSeconds: 30,
    } as unknown as ExecuteTriggerOperation<TriggerHookType.RUN>
}

describe('triggerHookOperation payload resolution', () => {
    beforeEach(() => {
        mockDownload.mockReset()
        mockExecuteTrigger.mockReset()
        mockExecuteTrigger.mockResolvedValue({ success: true, output: [] })
    })

    it('forwards an inline payload without hitting the engine file client', async () => {
        await triggerHookOperation.execute(makeOperation({ type: 'inline', value: { hello: 'world' } }))

        expect(mockDownload).not.toHaveBeenCalled()
        expect(mockExecuteTrigger).toHaveBeenCalledTimes(1)
        expect(mockExecuteTrigger.mock.calls[0][0].params.triggerPayload).toEqual({ hello: 'world' })
    })

    it('downloads a ref payload via the engine file client and forwards the parsed value', async () => {
        mockDownload.mockResolvedValue(new TextEncoder().encode(JSON.stringify({ hello: 'ref' })))

        await triggerHookOperation.execute(makeOperation({ type: 'ref', fileId: 'payload-file-1' }))

        expect(mockDownload).toHaveBeenCalledWith({
            apiUrl: 'http://localhost:3000/',
            engineToken: 'test-token',
            fileId: 'payload-file-1',
        })
        expect(mockExecuteTrigger.mock.calls[0][0].params.triggerPayload).toEqual({ hello: 'ref' })
    })

    it('forwards an undefined payload without hitting the engine file client', async () => {
        await triggerHookOperation.execute(makeOperation(undefined))

        expect(mockDownload).not.toHaveBeenCalled()
        expect(mockExecuteTrigger.mock.calls[0][0].params.triggerPayload).toBeUndefined()
    })

    it('handles ExecuteTriggerOperation with triggerBinding', async () => {
        const op = {
            hookType: TriggerHookType.RUN,
            test: false,
            triggerBinding: {
                id: 'tb-1',
                projectId: 'project-1',
                platformId: 'platform-1',
                pieceName: '@inboxfm-connect/piece-slack',
                pieceVersion: '0.1.0',
                triggerName: 'new_message',
                settings: {},
            },
            webhookUrl: 'http://localhost:4200/webhook',
            triggerPayload: { type: 'inline', value: { text: 'hello' } },
            projectId: 'project-1',
            platformId: 'platform-1',
            engineToken: 'test-token',
            internalApiUrl: 'http://localhost:3000/',
            publicApiUrl: 'http://localhost:4200/api/',
            timeoutInSeconds: 30,
        } as unknown as ExecuteTriggerOperation<TriggerHookType.RUN>

        await triggerHookOperation.execute(op)

        expect(mockExecuteTrigger).toHaveBeenCalledTimes(1)
        expect(mockExecuteTrigger.mock.calls[0][0].params.triggerBinding.id).toBe('tb-1')
    })
})

describe('triggerHookOperation failure classification', () => {
    beforeEach(() => {
        mockDownload.mockReset()
        mockExecuteTrigger.mockReset()
        mockExecuteTrigger.mockResolvedValue({ success: true, output: [] })
    })

    it('classifies a USER-level ExecutionError as USER_FAILURE', async () => {
        mockExecuteTrigger.mockRejectedValueOnce(new PropsValidationError({
            channel: ['Expected string, received: undefined'],
        }))

        const response = await triggerHookOperation.execute(makeOperation({ type: 'inline', value: {} }))

        expect(response.status).toBe(EngineResponseStatus.USER_FAILURE)
        expect(response.status).not.toBe(EngineResponseStatus.INTERNAL_ERROR)
    })

    it('classifies a non-ExecutionError crash as INTERNAL_ERROR, mirroring operations/index.ts', async () => {
        mockExecuteTrigger.mockRejectedValueOnce(new TypeError('piece trigger code crashed'))

        const response = await triggerHookOperation.execute(makeOperation({ type: 'inline', value: {} }))

        expect(response.status).toBe(EngineResponseStatus.INTERNAL_ERROR)
        expect(response.status).not.toBe(EngineResponseStatus.USER_FAILURE)
        expect(response.error).toContain('piece trigger code crashed')
    })

    it('logs non-user failures via console.error so engine crashes are not silent', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockExecuteTrigger.mockRejectedValueOnce(new TypeError('boom'))
        await triggerHookOperation.execute(makeOperation({ type: 'inline', value: {} }))
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
        consoleErrorSpy.mockRestore()
    })

    it('does not log USER-level ExecutionErrors via console.error', async () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        mockExecuteTrigger.mockRejectedValueOnce(new PropsValidationError({
            channel: ['Expected string, received: undefined'],
        }))
        await triggerHookOperation.execute(makeOperation({ type: 'inline', value: {} }))
        expect(consoleErrorSpy).not.toHaveBeenCalled()
        consoleErrorSpy.mockRestore()
    })

    it('re-throws ENGINE-level ExecutionErrors so operations/index.ts classifies them INTERNAL_ERROR', async () => {
        mockExecuteTrigger.mockRejectedValueOnce(new EngineGenericError('TriggerSandboxError', 'engine died'))

        await expect(triggerHookOperation.execute(makeOperation({ type: 'inline', value: {} })))
            .rejects.toThrow('engine died')
    })
})

