import {
    ContextVersion,
    createAction,
    createPiece,
    IntegrationAuthProperty,
    PieceAuth,
} from '@inboxfm-connect/pieces-framework'
import {
    EngineOperationType,
    EngineResponseStatus,
    ExecuteToolOperation,
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

// Mirrors the webhook return-response-and-wait-for-next-webhook pattern:
// createWaitpoint -> waitpoint.buildResumeUrl -> waitForWaitpoint.
const pausingTool = createAction({
    name: 'stub_pausing_action',
    displayName: 'Stub Pausing Action',
    description: 'Creates a waitpoint and builds a resume URL',
    requireAuth: false,
    props: {},
    async run(ctx) {
        const waitpoint = await ctx.run.createWaitpoint({ type: 'WEBHOOK' })
        return waitpoint.buildResumeUrl({ queryParams: { created: 'now' }, sync: true })
    },
})

const waitForWaitpointTool = createAction({
    name: 'stub_wait_for_waitpoint_action',
    displayName: 'Stub WaitForWaitpoint Action',
    description: 'Waits on a fabricated waitpoint id',
    requireAuth: false,
    props: {},
    async run(ctx) {
        ctx.run.waitForWaitpoint('fabricated-waitpoint-id')
        return 'waited'
    },
})

const contextProbeTool = createAction({
    name: 'stub_context_probe_action',
    displayName: 'Stub Context Probe Action',
    description: 'Reports which ToolContext members the headless context provides',
    requireAuth: false,
    props: {},
    async run(ctx) {
        return {
            externalIdType: typeof ctx.project.externalId,
            flowsCurrentId: ctx.flows.current.id,
            outputType: typeof ctx.output.update,
            agentType: typeof ctx.agent.tools,
            storeType: typeof ctx.store,
        }
    },
})

const legacyProbeTool = createAction({
    name: 'stub_legacy_probe_action',
    displayName: 'Stub Legacy Probe Action',
    description: 'Reports the legacy V1 surface after the run.pause removal',
    requireAuth: false,
    props: {},
    async run(ctx) {
        return {
            pausePresent: 'pause' in ctx.run,
            generateResumeUrlType: typeof ctx.generateResumeUrl,
        }
    },
})

const stubPiece = createPiece<IntegrationAuthProperty>({
    displayName: 'Stub Piece',
    logoUrl: 'https://example.com/logo.png',
    description: 'Stub piece for headless execute tests',
    authors: [],
    auth: PieceAuth.None(),
    actions: [pausingTool, waitForWaitpointTool, contextProbeTool],
})

const stubLegacyPiece = createPiece<IntegrationAuthProperty>({
    displayName: 'Stub Legacy Piece',
    logoUrl: 'https://example.com/logo.png',
    description: 'Stub V1-context piece for headless execute tests',
    authors: [],
    auth: PieceAuth.None(),
    actions: [legacyProbeTool],
})
// Simulates a piece compiled against an old framework that reports ContextVersion.V1.
stubLegacyPiece.getContextInfo = () => ({ version: ContextVersion.V1 })

function stubLoaderWith({ piece, pieceAction }: { piece: typeof stubPiece, pieceAction: typeof pausingTool }): void {
    vi.spyOn(pieceLoader, 'getPieceAndActionOrThrow').mockResolvedValue({ piece, pieceAction })
}

beforeEach(() => {
    vi.restoreAllMocks()
})

describe('executeTool headless run context', () => {
    it('fails pausing tools with a USER_FAILURE pause-unsupported error, not a TypeError', async () => {
        stubLoaderWith({ piece: stubPiece, pieceAction: pausingTool })

        const response = await execute(EngineOperationType.EXECUTE_TOOL, stubToolOperation)

        // The old dummy stub ({ id: 'dummy', token: 'dummy' }) crashed pieces with
        // "waitpoint.buildResumeUrl is not a function" (INTERNAL_ERROR).
        expect(response.status).toBe(EngineResponseStatus.USER_FAILURE)
        expect(response.status).not.toBe(EngineResponseStatus.INTERNAL_ERROR)
        const parsed = JSON.parse(response.error as string)
        expect(parsed.message).toContain('Pausing is not supported in headless tool execution')
        expect(parsed.message).not.toContain('is not a function')
    })

    it('fails waitForWaitpoint with the same explicit error', async () => {
        stubLoaderWith({ piece: stubPiece, pieceAction: waitForWaitpointTool })

        const response = await execute(EngineOperationType.EXECUTE_TOOL, stubToolOperation)

        expect(response.status).toBe(EngineResponseStatus.USER_FAILURE)
        expect(JSON.parse(response.error as string).message).toContain('Pausing is not supported in headless tool execution')
    })

    it('provides the ToolContext members the framework contract requires', async () => {
        stubLoaderWith({ piece: stubPiece, pieceAction: contextProbeTool })

        const result = await pieceHelper.executeTool({ params: stubToolOperation, devPieces: [] })

        expect(result.status).toBe(EngineResponseStatus.OK)
        expect(result.response).toEqual({
            // externalId must be the contract's () => Promise<string | undefined>, not the raw projectId string
            externalIdType: 'function',
            flowsCurrentId: 'mcp-flow-id',
            outputType: 'function',
            agentType: 'function',
            storeType: 'object',
        })
    })

    it('does not resurrect the removed legacy run.pause for ContextVersion.V1 pieces', async () => {
        stubLoaderWith({ piece: stubLegacyPiece, pieceAction: legacyProbeTool })

        const result = await pieceHelper.executeTool({ params: stubToolOperation, devPieces: [] })

        expect(result.status).toBe(EngineResponseStatus.OK)
        expect(result.response).toEqual({
            pausePresent: false,
            generateResumeUrlType: 'function',
        })
    })
})
