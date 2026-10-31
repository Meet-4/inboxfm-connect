import type { ServerErrorCodeContract } from './generated/error-code'

export class ConnectError extends Error {
    readonly category: ConnectErrorCategory
    readonly status?: number
    readonly code?: ServerErrorCode
    readonly params?: Record<string, unknown>
    readonly requestId?: string
    readonly retryable: boolean
    readonly retryAfterMs?: number

    constructor({ category, status, code, params, requestId, retryable, retryAfterMs, message, cause }: ConnectErrorOptions) {
        super(message, cause ? { cause } : undefined)
        this.name = 'ConnectError'
        this.category = category
        this.status = status
        this.code = code
        this.params = params
        this.requestId = requestId
        this.retryable = retryable
        this.retryAfterMs = retryAfterMs
        Object.setPrototypeOf(this, ConnectError.prototype)
    }

    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            message: this.message,
            category: this.category,
            status: this.status,
            code: this.code,
            params: this.params,
            requestId: this.requestId,
            retryable: this.retryable,
            retryAfterMs: this.retryAfterMs,
        }
    }
}

function categoryFromStatus({ status, code }: { status: number, code?: string }): ConnectErrorCategory {
    if (status === 401) {
        return 'authentication'
    }
    if (status === 403) {
        return 'authentication'
    }
    if (status === 404) {
        return 'not_found'
    }
    if (status === 429) {
        return 'rate_limit'
    }
    if (status === 409) {
        return code === 'VALIDATION' ? 'validation' : 'conflict'
    }
    if (status >= 500) {
        return 'server'
    }
    if (status >= 400) {
        return 'validation'
    }
    return 'unknown'
}

async function fromResponse({ response, requestId }: { response: Response, requestId?: string }): Promise<ConnectError> {
    const rawBody = await response.text()
    const parsed = parseErrorBody(rawBody)
    const category = categoryFromStatus({ status: response.status, code: parsed.code })
    return new ConnectError({
        category,
        status: response.status,
        code: parsed.code,
        params: parsed.params,
        requestId: requestId ?? response.headers.get('x-request-id') ?? undefined,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfterMs({ header: response.headers.get('retry-after') }),
        message: parsed.message ?? `Inboxfm Connect API error (${response.status})`,
    })
}

function fromNetworkError({ cause }: { cause: unknown }): ConnectError {
    return new ConnectError({
        category: 'network',
        retryable: true,
        message: cause instanceof Error ? cause.message : 'Network request failed',
        cause,
    })
}

function fromTimeout({ timeoutMs }: { timeoutMs: number }): ConnectError {
    return new ConnectError({
        category: 'timeout',
        retryable: true,
        message: `Request timed out after ${timeoutMs}ms`,
    })
}

function fromAbort(): ConnectError {
    return new ConnectError({
        category: 'aborted',
        retryable: false,
        message: 'Request was aborted by the caller',
    })
}

function parseRetryAfterMs({ header }: { header: string | null }): number | undefined {
    if (!header) {
        return undefined
    }
    const seconds = Number(header)
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000)
    }
    const dateMs = Date.parse(header)
    if (Number.isNaN(dateMs)) {
        return undefined
    }
    return Math.max(0, dateMs - Date.now())
}

/**
 * Reads the human-readable reason out of the two error-body shapes this backend
 * sends, mirroring the priority the web client uses:
 *
 * - Fastify-generated errors and any handler that sets a top-level `message`
 *   keep that message.
 * - The server's error handler (`app/helper/error-handler.ts`) serializes
 *   ActivepiecesError bodies as `{ code, params }` with NO top-level `message` —
 *   the reason lives at `params.message` (VALIDATION, AUTHORIZATION,
 *   ENGINE_OPERATION_FAILURE, SESSION_EXPIRED, …) or `params.error`
 *   (INVALID_APP_CONNECTION). Without this fallback, every such failure surfaced
 *   as the generic "Inboxfm Connect API error (NNN)" while `error.params` held
 *   the actual text the server produced.
 */
function parseErrorBody(rawBody: string): { code?: string, params?: Record<string, unknown>, message?: string } {
    if (!rawBody) {
        return {}
    }
    try {
        const body: unknown = JSON.parse(rawBody)
        if (typeof body !== 'object' || body === null) {
            return { message: rawBody }
        }
        const record = body as Record<string, unknown>
        const code = typeof record['code'] === 'string' ? record['code'] : undefined
        const params = typeof record['params'] === 'object' && record['params'] !== null
            ? record['params'] as Record<string, unknown>
            : undefined
        const message = readErrorMessage({ record, params })
        return { code, params, message }
    }
    catch {
        return { message: rawBody }
    }
}

function readErrorMessage({ record, params }: { record: Record<string, unknown>, params?: Record<string, unknown> }): string | undefined {
    if (typeof record['message'] === 'string') {
        return record['message']
    }
    if (params === undefined) {
        return undefined
    }
    if (typeof params['message'] === 'string') {
        return params['message']
    }
    if (typeof params['error'] === 'string') {
        return params['error']
    }
    return undefined
}

export const connectErrorFactory = {
    fromResponse,
    fromNetworkError,
    fromTimeout,
    fromAbort,
}

export type ConnectErrorCategory =
    | 'authentication'
    | 'validation'
    | 'not_found'
    | 'conflict'
    | 'rate_limit'
    | 'server'
    | 'network'
    | 'timeout'
    | 'aborted'
    | 'unknown'

export type ConnectErrorOptions = {
    category: ConnectErrorCategory
    retryable: boolean
    message: string
    status?: number
    code?: ServerErrorCode
    params?: Record<string, unknown>
    requestId?: string
    retryAfterMs?: number
    cause?: unknown
}

/**
 * Widened with `string & {}` (rather than plain `string`) so editors still suggest
 * the known server codes while remaining forward-compatible with codes the server
 * adds after this SDK was generated.
 */
export type ServerErrorCode = ServerErrorCodeContract | (string & NonNullable<unknown>)
