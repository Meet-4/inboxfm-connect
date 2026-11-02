import { apLogger } from '@inboxfm-connect/server-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { executeAdhocAction } from '../../../../../src/app/mcp/tools/flow-run-utils'

interface FakeConnection {
    id: string
    externalId: string
    pieceName: string
    status?: string
}

let connections: FakeConnection[] = []

const executeMock = vi.fn()

vi.mock('@inboxfm-connect/runtime', () => ({
    HeadlessRuntime: class {
        execute = (...args: unknown[]) => executeMock(...args)
    },
}))

vi.mock('../../../../../src/app/project/project-service', () => ({
    projectService: () => ({
        getOneOrThrow: vi.fn().mockResolvedValue({ id: 'project-1', platformId: 'platform-1' }),
    }),
}))

vi.mock('../../../../../src/app/helper/system/system', () => ({
    system: {
        get: vi.fn().mockReturnValue(undefined),
        // domainHelper.getPublicUrl reads FRONTEND_URL via getOrThrow; the mocked
        // system.get returns undefined, so give domainHelper its base URL here.
        getOrThrow: vi.fn().mockReturnValue('http://localhost:4200'),
    },
}))

vi.mock('../../../../../src/app/authentication/lib/access-token-manager', () => ({
    accessTokenManager: () => ({
        generateEngineToken: vi.fn().mockResolvedValue('engine-token-for-project-1'),
    }),
}))

vi.mock('../../../../../src/app/app-connection/app-connection-service/app-connection-service', () => ({
    appConnectionsRepo: () => ({
        find: async () => connections,
        findOneBy: vi.fn(),
    }),
    appConnectionService: () => ({
        decryptAndRefreshConnection: vi.fn(),
    }),
}))

const log = apLogger.create({ bindings: {} })

const run = ({ pieceName, connectionExternalId, actionName = 'send_email' }: { pieceName: string, connectionExternalId?: string, actionName?: string }) =>
    executeAdhocAction({
        projectId: 'project-1',
        pieceName,
        actionName,
        input: {},
        connectionExternalId,
        log,
    })

describe('executeAdhocAction connection resolution', () => {
    beforeEach(() => {
        executeMock.mockReset()
        executeMock.mockResolvedValue({ status: 'ok' })
        connections = [
            { id: 'conn-store', externalId: 'e2e-store', pieceName: '@inboxfm-connect/piece-store' },
            { id: 'conn-resend', externalId: 'resend-mihir', pieceName: '@inboxfm-connect/piece-resend' },
        ]
    })

    it('uses the requested externalId when it belongs to the requested piece', async () => {
        await run({ pieceName: '@inboxfm-connect/piece-resend', connectionExternalId: 'resend-mihir' })

        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-resend' }))
    })

    it('never pairs an externalId from another piece with the requested piece', async () => {
        await run({ pieceName: '@inboxfm-connect/piece-resend', connectionExternalId: 'e2e-store' })

        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-resend' }))
    })

    it('throws an actionable error when only other-piece connections exist', async () => {
        connections = [{ id: 'conn-store', externalId: 'e2e-store', pieceName: '@inboxfm-connect/piece-store' }]

        await expect(run({ pieceName: '@inboxfm-connect/piece-resend', connectionExternalId: 'e2e-store' })).rejects.toThrow(
            /No connection found for integration "@inboxfm-connect\/piece-resend".*e2e-store/,
        )
        expect(executeMock).not.toHaveBeenCalled()
    })

    it('resolves a short piece name to scoped connection rows', async () => {
        await run({ pieceName: 'resend' })

        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
            integration: '@inboxfm-connect/piece-resend',
            connectionId: 'conn-resend',
        }))
    })

    it('auto-picks the piece connection when no externalId is passed', async () => {
        await run({ pieceName: '@inboxfm-connect/piece-store' })

        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'conn-store' }))
    })

    it('still demands a connection when the project has none', async () => {
        connections = []

        await expect(run({ pieceName: '@inboxfm-connect/piece-resend' })).rejects.toThrow(
            'A connection must be created first before executing a tool.',
        )
        expect(executeMock).not.toHaveBeenCalled()
    })
})

describe('executeAdhocAction engine context dispatch (#544)', () => {
    beforeEach(() => {
        executeMock.mockReset()
        executeMock.mockResolvedValue({ status: 'ok' })
        connections = [
            { id: 'conn-resend', externalId: 'resend-mihir', pieceName: '@inboxfm-connect/piece-resend', status: 'ACTIVE' },
        ]
    })

    it('passes /api-suffixed internal and public API URLs — the sandbox appends v1/... to them', async () => {
        await run({ pieceName: 'resend' })

        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
            internalApiUrl: 'http://localhost:4200/api/',
            publicApiUrl: 'http://localhost:4200/api/',
        }))
    })

    it('passes a real minted engine token, never the headless placeholder rejected by securityAccess.engine routes', async () => {
        await run({ pieceName: 'resend' })

        const dispatchParams = executeMock.mock.calls[0][0] as Record<string, unknown>
        expect(dispatchParams.engineToken).toBe('engine-token-for-project-1')
        expect(dispatchParams.engineToken).not.toBe('headless')
        expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({
            projectId: 'project-1',
            platformId: 'platform-1',
        }))
    })
})

describe('executeAdhocAction MISSING connection warning (#546)', () => {
    beforeEach(() => {
        executeMock.mockReset()
        executeMock.mockResolvedValue({ mapped: 'output' })
    })

    it('flags a MISSING connection in the tool result while still executing it', async () => {
        connections = [
            { id: 'conn-slack', externalId: 'slack-mihir', pieceName: '@inboxfm-connect/piece-slack', status: 'MISSING' },
        ]

        const result = await run({ pieceName: 'slack' })

        // The tool still executes — a MISSING connection is a placeholder, not a hard
        // error; the fix is the visibility of the status in the tool result.
        expect(executeMock).toHaveBeenCalledTimes(1)
        expect(result.content[0]?.text).toContain('status MISSING')
        expect(result.content[0]?.text).toContain('slack-mihir')
        // The engine output still follows the warning.
        expect(result.content[1]?.text).toContain('"mapped": "output"')
        // The status is surfaced for agents that read structuredContent.
        expect(result.structuredContent).toMatchObject({ connectionStatus: 'MISSING' })
    })

    it('adds no warning for an ACTIVE connection', async () => {
        connections = [
            { id: 'conn-slack', externalId: 'slack-mihir', pieceName: '@inboxfm-connect/piece-slack', status: 'ACTIVE' },
        ]

        const result = await run({ pieceName: 'slack' })

        expect(result.content[0]?.text).not.toContain('MISSING')
        expect(result.structuredContent ?? {}).not.toHaveProperty('connectionStatus')
    })
})
