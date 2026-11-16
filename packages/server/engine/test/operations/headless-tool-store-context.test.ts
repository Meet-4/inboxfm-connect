import { EngineResponseStatus, ExecuteToolOperation } from '@inboxfm-connect/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pieceHelper } from '../../src/lib/helper/piece-helper'
import { pieceLoader } from '../../src/lib/helper/piece-loader'

const fetchMock = vi.fn()

// executeTool resolves pieces from disk via the loader; the wiring under test is the
// operation -> context handoff, so the loader is replaced with an in-memory piece
// whose action records what the store client actually sends over the wire.
vi.mock('../../src/lib/helper/piece-loader', () => ({
    pieceLoader: {
        getPieceAndActionOrThrow: vi.fn(),
    },
}))

describe('executeTool store context (Issue #544)', () => {
    afterEach(() => {
        fetchMock.mockReset()
        vi.mocked(pieceLoader.getPieceAndActionOrThrow).mockReset()
        vi.unstubAllGlobals()
    })

    it('threads the operation internalApiUrl and engineToken into the store client', async () => {
        const runMock = vi.fn(async (context: { store: { put: (key: string, value: unknown) => Promise<unknown> } }) => {
            await context.store.put('demo-status', 'ok')
            return { stored: true }
        })
        vi.mocked(pieceLoader.getPieceAndActionOrThrow).mockResolvedValue({
            piece: {},
            pieceAction: {
                name: 'put',
                displayName: 'Put',
                description: 'Store a value',
                props: {},
                requireAuth: false,
                run: runMock,
            },
        // The stub only fills the fields executeTool reads; the real Piece/Action types
        // carry piece metadata this path never touches.
        } as unknown as Awaited<ReturnType<typeof pieceLoader.getPieceAndActionOrThrow>>)

        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ value: 'ok' }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const operation: ExecuteToolOperation = {
            pieceName: '@inboxfm-connect/piece-store',
            pieceVersion: '0.0.1',
            actionName: 'put',
            input: {},
            engineToken: 'engine-token-from-operation',
            internalApiUrl: 'http://engine-api.internal/api/',
            publicApiUrl: 'http://engine-api.internal/api/',
            timeoutInSeconds: 60,
            projectId: 'test-project',
            platformId: 'test-platform',
        }

        const response = await pieceHelper.executeTool({ params: operation, devPieces: [] })

        expect(response.status).toBe(EngineResponseStatus.OK)
        expect(response.response).toEqual({ stored: true })

        // The store request must be built from the operation's internalApiUrl (with the
        // /api/ base, so new URL() does not throw "Invalid URL") and authorized with the
        // operation's engineToken — previously the headless context dropped it entirely,
        // so store-touching pieces crashed or 401'd on MCP ap_run_action executions.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [calledUrl, calledInit] = fetchMock.mock.calls[0]
        expect(String(calledUrl)).toBe('http://engine-api.internal/api/v1/store-entries')
        expect((calledInit as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer engine-token-from-operation')
    })
})
