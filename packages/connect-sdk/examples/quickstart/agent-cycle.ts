import type { Connection, InboxFM, Tool } from '@inboxfm-connect/sdk'

export async function runAgentCycle({ client, externalUserId, integration, tool, input, connectTimeoutMs, pollIntervalMs, log }: RunAgentCycleParams): Promise<AgentCycleResult> {
    const connection = await findOrWaitForConnection({ client, externalUserId, integration, connectTimeoutMs, pollIntervalMs, log })
    log(`Using connection ${connection.id} (${connection.displayName})`)

    const tools = await client.listTools({ integration })
    log(`${integration} exposes ${tools.length} tool(s): ${tools.map((candidate) => candidate.name).join(', ')}`)
    const selectedTool = tools.find((candidate) => candidate.name === tool)
    if (!selectedTool) {
        throw new Error(`Tool "${tool}" is not available on ${integration}`)
    }
    const missingInputs = findMissingRequiredInputs({ tool: selectedTool, input })
    if (missingInputs.length > 0) {
        throw new Error(`Tool "${tool}" requires input(s) that were not provided: ${missingInputs.join(', ')}`)
    }

    const output = await client.execute({ integration, tool, connectionId: connection.id, input })
    return { connection, tool: selectedTool, output }
}

async function findOrWaitForConnection({ client, externalUserId, integration, connectTimeoutMs, pollIntervalMs, log }: FindOrWaitForConnectionParams): Promise<Connection> {
    const existing = await findActiveConnection({ client, externalUserId, integration })
    if (existing) {
        return existing
    }

    // The end-user authorizes the integration in their own browser, so the backend only
    // hands out the URL and polls; it never sees the user's third-party credentials.
    const session = await client.createConnectSession({ externalUserId, allowedPieceNames: [integration] })
    log(`No ${integration} connection for ${externalUserId} yet. Open this link to connect it (expires ${session.expiresAt}):`)
    log(session.connectUrl)

    const deadline = Date.now() + connectTimeoutMs
    while (Date.now() < deadline) {
        await sleep({ ms: pollIntervalMs })
        const connection = await findActiveConnection({ client, externalUserId, integration })
        if (connection) {
            return connection
        }
    }
    throw new Error(`Timed out after ${connectTimeoutMs}ms waiting for ${externalUserId} to connect ${integration}`)
}

// Exported for the package's example tests: the pagination walk (and its page
// cap) is part of the quickstart's documented behavior, not an implementation
// detail — the README tells developers to "paginate with cursor/limit".
export async function findActiveConnection({ client, externalUserId, integration }: { client: InboxFM, externalUserId: string, integration: string }): Promise<Connection | undefined> {
    // The server pages connections (10 per page by default), so the customer's
    // active connection can sit past the first page. Follow `next` until it is
    // exhausted instead of reading a single page — otherwise a customer with a
    // fuller connection list is told to reconnect even though they are connected,
    // and the wait loop below can never observe the connection it is polling for.
    // The page cap keeps a misbehaving cursor sequence (a repeated cursor makes
    // the server serve the first page again) from looping forever.
    const MAX_PAGES = 50
    let cursor: string | undefined = undefined
    for (let page = 0; page < MAX_PAGES; page++) {
        const result = await client.listConnections({ externalUserId, pieceName: integration, cursor })
        const active = result.data.find((connection) => connection.status === 'ACTIVE')
        if (active) {
            return active
        }
        cursor = result.next ?? undefined
        if (cursor === undefined) {
            return undefined
        }
    }
    return undefined
}

function findMissingRequiredInputs({ tool, input }: { tool: Tool, input: Record<string, unknown> }): string[] {
    return tool.inputs
        .filter((toolInput) => toolInput.required && input[toolInput.name] === undefined)
        .map((toolInput) => toolInput.name)
}

function sleep({ ms }: { ms: number }): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export type RunAgentCycleParams = {
    client: InboxFM
    externalUserId: string
    integration: string
    tool: string
    input: Record<string, unknown>
    connectTimeoutMs: number
    pollIntervalMs: number
    log: (line: string) => void
}

export type AgentCycleResult = {
    connection: Connection
    tool: Tool
    output: unknown
}

type FindOrWaitForConnectionParams = Pick<RunAgentCycleParams, 'client' | 'externalUserId' | 'integration' | 'connectTimeoutMs' | 'pollIntervalMs' | 'log'>
