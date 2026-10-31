import type {
    ConnectionsPage,
    CreateConnectSessionResponseContract,
    CreateMcpTokenResponseContract,
    ExecuteRequestContract,
    IntegrationToolsResponse,
    ListConnectionsQueryContract,
    Tool,
    ToolContract,
    ToolInput,
    ToolInputContract,
} from './api-types'
import { ConnectError, connectErrorFactory } from './errors'
import { transport } from './transport'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 250
const DEFAULT_MAX_DELAY_MS = 4_000

export class InboxFM {
    private readonly apiKey: string
    private readonly projectId: string
    private readonly baseUrl: string
    private readonly defaultTimeoutMs: number
    private readonly maxAttempts: number
    private readonly baseDelayMs: number
    private readonly maxDelayMs: number

    constructor({ apiKey, projectId, baseUrl, timeoutMs, maxAttempts, retryBaseDelayMs, retryMaxDelayMs }: InboxFMOptions) {
        this.apiKey = apiKey
        this.projectId = projectId
        this.baseUrl = baseUrl.replace(/\/+$/, '')
        this.defaultTimeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS
        this.maxAttempts = maxAttempts ?? DEFAULT_MAX_ATTEMPTS
        this.baseDelayMs = retryBaseDelayMs ?? DEFAULT_BASE_DELAY_MS
        this.maxDelayMs = retryMaxDelayMs ?? DEFAULT_MAX_DELAY_MS
    }

    async createConnectSession({ externalUserId, allowedPieceNames, expiresInSeconds, ...requestOptions }: CreateConnectSessionParams): Promise<CreateConnectSessionResult> {
        return this.request<CreateConnectSessionResult>('/v1/connect-sessions', {
            method: 'POST',
            body: {
                projectId: this.projectId,
                externalUserId,
                allowedPieceNames,
                expiresInSeconds,
            },
            ...requestOptions,
        })
    }

    async createMcpToken({ externalUserId, allowedPieceNames, expiresInSeconds, ...requestOptions }: CreateMcpTokenParams): Promise<CreateMcpTokenResult> {
        return this.request<CreateMcpTokenResult>('/v1/connect-mcp/token', {
            method: 'POST',
            body: {
                projectId: this.projectId,
                externalUserId,
                allowedPieceNames,
                expiresInSeconds,
            },
            ...requestOptions,
        })
    }

    async listConnections({ externalUserId, pieceName, cursor, limit, ...requestOptions }: ListConnectionsParams): Promise<ListConnectionsResult> {
        const query = new URLSearchParams({ projectId: this.projectId, externalId: externalUserId })
        if (pieceName) {
            query.set('pieceName', pieceName)
        }
        if (cursor) {
            query.set('cursor', cursor)
        }
        if (limit !== undefined) {
            query.set('limit', String(limit))
        }
        return this.request<ListConnectionsResult>(`/v1/connections?${query.toString()}`, {
            method: 'GET',
            ...requestOptions,
        })
    }

    async listTools({ integration, version, ...requestOptions }: ListToolsParams): Promise<Tool[]> {
        const query = version ? `?${new URLSearchParams({ version }).toString()}` : ''
        const metadata = await this.request<IntegrationToolsResponse>(`/v1/integrations/${encodeURIComponent(integration)}${query}`, {
            method: 'GET',
            ...requestOptions,
        })
        return Object.values(metadata.actions).map((action) => toTool({ action }))
    }

    async execute({ integration, tool, connectionId, externalUserId, input, ...requestOptions }: ExecuteParams): Promise<unknown> {
        return this.request('/v1/execute', {
            method: 'POST',
            body: {
                projectId: this.projectId,
                integration,
                tool,
                connectionId,
                externalUserId,
                input,
            },
            ...requestOptions,
        })
    }

    async deleteConnection({ connectionId, ...requestOptions }: DeleteConnectionParams): Promise<void> {
        await this.request(`/v1/connections/${connectionId}`, {
            method: 'DELETE',
            retryable: true,
            ...requestOptions,
        })
    }

    async proxy({
        externalUserId,
        provider,
        connectionId,
        subdomain,
        method = 'GET',
        path,
        headers,
        query,
        body,
        timeoutMs,
        idempotencyKey,
        ...requestOptions
    }: ConnectProxyParams): Promise<ConnectProxyResult> {
        return this.request<ConnectProxyResult>('/v1/connect-proxy/request', {
            method: 'POST',
            body: {
                projectId: this.projectId,
                externalUserId,
                provider,
                connectionId,
                subdomain,
                method,
                path,
                headers,
                query,
                body,
                // The server's ConnectProxyRequest schema bounds this upstream budget
                // to [500, 60000] ms (integer); anything else is a 400 on every call.
                // The SDK reuses its transport `timeoutMs` option as this value, so a
                // legitimate client-side budget (e.g. 2 minutes) must not fail the
                // request server-side — normalize it into the accepted range.
                timeoutMs: toUpstreamTimeoutMs(timeoutMs),
                idempotencyKey,
            },
            idempotencyKey,
            timeoutMs,
            ...requestOptions,
        })
    }

    private async request<T>(path: string, { method, body, ...requestOptions }: { method: string, body?: unknown } & ConnectRequestOptions): Promise<T> {
        try {
            return await transport.request<T>({
                url: `${this.baseUrl}${path}`,
                method,
                body,
                apiKey: this.apiKey,
                timeoutMs: requestOptions.timeoutMs ?? this.defaultTimeoutMs,
                maxAttempts: this.maxAttempts,
                baseDelayMs: this.baseDelayMs,
                maxDelayMs: this.maxDelayMs,
                signal: requestOptions.signal,
                retryable: requestOptions.retryable,
                idempotencyKey: requestOptions.idempotencyKey,
            })
        }
        catch (error) {
            // The README promises every failed request rejects with a ConnectError,
            // never a bare Error. A 2xx whose body is not the promised JSON (an HTML
            // error page from a captive portal or misrouted gateway, an empty body)
            // makes the body parse throw a bare SyntaxError; surface it typed instead.
            // It is marked retryable (like a 502: transient in principle), but the
            // decision to retry lives in the transport, which has already returned.
            if (error instanceof SyntaxError) {
                throw connectErrorFactory.fromMalformedBody({ cause: error })
            }
            throw error
        }
    }
}

function toTool({ action }: { action: IntegrationToolsResponse['actions'][string] }): Tool {
    const summary: ToolContract = {
        name: action.name,
        displayName: action.displayName,
        description: action.description,
        requireAuth: action.requireAuth,
        ...(action.audience !== undefined ? { audience: action.audience } : {}),
        ...(action.aiMetadata !== undefined ? { aiMetadata: action.aiMetadata } : {}),
    }
    const inputs = Object.entries(action.props).map(([name, prop]) => toToolInput({ name, prop }))
    return { ...summary, inputs }
}

function toToolInput({ name, prop }: { name: string, prop: ToolInputContract }): ToolInput {
    return {
        name,
        displayName: prop.displayName,
        type: prop.type,
        required: prop.required,
        ...(prop.description !== undefined ? { description: prop.description } : {}),
    }
}

// The server's `ConnectProxyRequest` zod contract accepts an integer upstream
// timeout of 500..60000 ms and defaults to 30000 when the field is omitted
// (`packages/core/shared/src/lib/connect-proxy/index.ts`). Values outside that
// range are rejected with a 400 on every call, and `JSON.stringify` writes a
// non-finite number as `null`, which the server rejects the same way.
const PROXY_UPSTREAM_TIMEOUT_MIN_MS = 500
const PROXY_UPSTREAM_TIMEOUT_MAX_MS = 60_000

/**
 * Normalizes the caller's `timeoutMs` into the upstream budget the server
 * accepts: in-range values pass through untouched, out-of-range or non-integer
 * values are clamped/rounded into the accepted window, and unusable values
 * (undefined, NaN, Infinity) are dropped so the server applies its own default.
 * The caller's client-side transport timeout is not altered by this.
 */
function toUpstreamTimeoutMs(timeoutMs: number | undefined): number | undefined {
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) {
        return undefined
    }
    return Math.min(
        PROXY_UPSTREAM_TIMEOUT_MAX_MS,
        Math.max(PROXY_UPSTREAM_TIMEOUT_MIN_MS, Math.round(timeoutMs)),
    )
}

export { ConnectError }
export type { ConnectErrorCategory, ConnectErrorOptions, ServerErrorCode } from './errors'
export type { Connection, ConnectionsPage, Tool, ToolInput } from './api-types'

export type ConnectRequestOptions = {
    signal?: AbortSignal
    timeoutMs?: number
    retryable?: boolean
    idempotencyKey?: string
}

export type InboxFMOptions = {
    apiKey: string
    projectId: string
    baseUrl: string
    timeoutMs?: number
    maxAttempts?: number
    retryBaseDelayMs?: number
    retryMaxDelayMs?: number
}

export type CreateConnectSessionParams = {
    externalUserId: string
    allowedPieceNames?: string[]
    expiresInSeconds?: number
} & ConnectRequestOptions

export type CreateConnectSessionResult = CreateConnectSessionResponseContract

export type CreateMcpTokenParams = {
    externalUserId: string
    allowedPieceNames?: string[]
    expiresInSeconds?: number
} & ConnectRequestOptions

export type CreateMcpTokenResult = CreateMcpTokenResponseContract

export type ListConnectionsParams = {
    externalUserId: string
    pieceName?: string
} & Pick<ListConnectionsQueryContract, 'cursor' | 'limit'> & ConnectRequestOptions

export type ListConnectionsResult = ConnectionsPage

export type ListToolsParams = {
    integration: string
    version?: string
} & ConnectRequestOptions

export type ExecuteParams = Omit<ExecuteRequestContract, 'projectId'> & ConnectRequestOptions

export type DeleteConnectionParams = {
    connectionId: string
} & ConnectRequestOptions

export type ConnectProxyParams = Omit<import('./api-types').ConnectProxyRequest, 'projectId'> & ConnectRequestOptions

export type ConnectProxyResult = import('./api-types').ConnectProxyResponse

export type { ConnectProxyRequest, ConnectProxyResponse, ProxyHttpMethod } from './api-types'
