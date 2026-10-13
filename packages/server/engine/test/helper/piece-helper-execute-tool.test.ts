import {
    EngineOperationType,
    EngineResponseStatus,
    ExecuteToolOperation,
    ExecutionError,
    ExecutionErrorType,
} from '@inboxfm-connect/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pieceLoader } from '../../src/lib/helper/piece-loader'
import { pieceHelper } from '../../src/lib/helper/piece-helper'
import { execute } from '../../src/lib/operations'

const stubToolOperation: ExecuteToolOperation = {
    pieceName: 'stub-piece',
    pieceVersion: '1.0.0',
    actionName: 'stub_action',
    input: {},
    projectId: 'test-project',
    platformId: 'test-platform',
    engineToken: 'test-token',
    publicApiUrl: 'http://localhost:3000/api/',
    internalApiUrl: 'http://localhost:3000/api/',
    timeoutInSeconds: 60,
}

type StubToolContext = Record<string, Record<string, unknown> | string>

function stubToolWith(run: (context: StubToolContext) => unknown): void {
    vi.spyOn(pieceLoader, 'getPieceAndActionOrThrow').mockResolvedValue({
        piece: {
            auth: undefined,
        },
        pieceAction: {
            name: 'stub_action',
            displayName: 'Stub Action',
            description: 'stub',
            props: {},
            requireAuth: false,
            run,
        },
    })
}

beforeEach(() => {
    vi.restoreAllMocks()
})

describe('executeTool headless run context', () => {
    it('rejects createWaitpoint with an explicit USER error instead of a contract-violating dummy', async () => {
        stubToolWith(async (context) => {
            const run = context.run as Record<string, unknown>
            return await (run['createWaitpoint'] as (params: unknown) => Promise<unknown>)({ type: 'WEBHOOK' })
        })

        const error = await pieceHelper.executeTool({ params: stubToolOperation, devPieces: [] }).catch((e) => e)
        expect(error).toBeInstanceOf(ExecutionError)
        expect(error.name).toBe('PauseUnsupportedInHeadlessModeError')
        expect(error.type).toBe(ExecutionErrorType.USER)
    })

    it('rejects waitForWaitpoint with the same explicit error', async () => {
        stubToolWith((context) => {
            const run = context.run as Record<string, unknown>
            ;(run['waitForWaitpoint'] as (waitpointId: string) => void)('some-id')
            return 'no-crash'
        })

        const error = await pieceHelper.executeTool({ params: stubToolOperation, devPieces: [] }).catch((e) => e)
        expect(error.name).toBe('PauseUnsupportedInHeadlessModeError')
    })

    it('surfaces the pause error as USER_FAILURE through the engine response, not a TypeError', async () => {
        stubToolWith(async (context) => {
            const run = context.run as Record<string, unknown>
            const waitpoint = await (run['createWaitpoint'] as (params: unknown) => Promise<unknown>)({ type: 'WEBHOOK' })
            // The old dummy stub crashed pieces here: waitpoint.buildResumeUrl is not a function
            return (waitpoint as Record<string, unknown>)['buildResumeUrl']({})
        })

        const response = await execute(EngineOperationType.EXECUTE_TOOL, stubToolOperation)
        expect(response.status).toBe(EngineResponseStatus.USER_FAILURE)
        expect(response.status).not.toBe(EngineResponseStatus.INTERNAL_ERROR)
        expect(JSON.parse(response.error as string).message).toContain('Pausing is not supported in headless tool execution')
    })

    it('provides the ToolContext members the framework contract requires', async () => {
        const observed: Record<string, unknown> = {}
        stubToolWith((context) => {
            observed.projectExternalIdType = typeof (context.project as Record<string, unknown>)['externalId']
            observed.flowsCurrentId = ((context.flows as Record<string, Record<string, unknown>>)['current'])['id']
            observed.outputUpdateType = typeof (context.output as Record<string, unknown>)['update']
            observed.agentToolsType = typeof (context.agent as Record<string, unknown>)['tools']
            observed.storeType = typeof context.store
            return 'tool-ran-to-completion'
        })

        const result = await pieceHelper.executeTool({ params: stubToolOperation, devPieces: [] })

        // externalId must be the contract's () => Promise<string | undefined>, not the raw projectId string
        expect(observed.projectExternalIdType).toBe('function')
        expect(observed.flowsCurrentId).toBe('mcp-flow-id')
        expect(observed.outputUpdateType).toBe('function')
        expect(observed.agentToolsType).toBe('function')
        expect(observed.storeType).toBe('object')
        expect(result).toEqual({
            status: EngineResponseStatus.OK,
            response: 'tool-ran-to-completion',
        })
    })
})
