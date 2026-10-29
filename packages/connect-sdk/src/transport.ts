import { connectErrorFactory, ConnectError } from './errors'
import { retryPolicy } from './retry'

const SAFE_METHODS = new Set(['GET', 'HEAD'])

async function request<T>({
    url,
    method,
    body,
    headers,
    apiKey,
    signal,
    timeoutMs,
    retryable,
    idempotencyKey,
    maxAttempts,
    baseDelayMs,
    maxDelayMs,
}: RequestOptions): Promise<T> {
    const isSafeMethod = SAFE_METHODS.has(method)
    const shouldAttemptRetries = retryable ?? isSafeMethod

    return retryPolicy.withRetry({
        fn: () => performRequest<T>({ url, method, body, headers, apiKey, signal, timeoutMs, idempotencyKey }),
        shouldRetry: (error) => isRetryableError({ error, shouldAttemptRetries }),
        maxAttempts,
        baseDelayMs,
        maxDelayMs,
        signal,
    })
}

function isRetryableError({ error, shouldAttemptRetries }: { error: unknown, shouldAttemptRetries: boolean }): boolean {
    if (!(error instanceof ConnectError) || !error.retryable) {
        return false
    }
    if (error.status === 429) {
        return true
    }
    return shouldAttemptRetries
}

async function performRequest<T>({ url, method, body, headers, apiKey, signal, timeoutMs, idempotencyKey }: PerformRequestOptions): Promise<T> {
    const timeoutController = new AbortController()
    const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs)
    const combinedSignal = linkSignals({ signals: [signal, timeoutController.signal] })

    try {
        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
                ...headers,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
            signal: combinedSignal,
        })
        if (!response.ok) {
            throw await connectErrorFactory.fromResponse({ response })
        }
        if (response.status === 204) {
            return undefined as T
        }
        // The timeout stays armed until the body has been read: `fetch` resolves as
        // soon as the headers arrive, so clearing it here let a server that stalls the
        // body hold the caller for as long as the runtime's own socket timeouts allow
        // (undici: 5 minutes) regardless of `timeoutMs`.
        return await readJsonBody<T>({ response, signal: combinedSignal })
    }
    catch (cause) {
        if (cause instanceof ConnectError) {
            throw cause
        }
        if (signal?.aborted) {
            throw connectErrorFactory.fromAbort()
        }
        if (timeoutController.signal.aborted) {
            throw connectErrorFactory.fromTimeout({ timeoutMs })
        }
        throw connectErrorFactory.fromNetworkError({ cause })
    }
    finally {
        clearTimeout(timeoutTimer)
    }
}

/**
 * Reads the JSON body while the request's abort/timeout signal is still armed.
 * Aborting a signal does not reliably interrupt an already-received body stream, so
 * the read is raced against the signal instead of trusting `fetch` to reject.
 */
async function readJsonBody<T>({ response, signal }: { response: Response, signal: AbortSignal }): Promise<T> {
    if (signal.aborted) {
        throw abortReason({ signal })
    }
    return await new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(abortReason({ signal }))
        signal.addEventListener('abort', onAbort, { once: true })
        response.json().then(
            (value) => {
                signal.removeEventListener('abort', onAbort)
                resolve(value as T)
            },
            (error: unknown) => {
                signal.removeEventListener('abort', onAbort)
                reject(error)
            },
        )
    })
}

function abortReason({ signal }: { signal: AbortSignal }): unknown {
    return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}

function linkSignals({ signals }: { signals: Array<AbortSignal | undefined> }): AbortSignal {
    const definedSignals = signals.filter((candidate): candidate is AbortSignal => candidate !== undefined)
    const controller = new AbortController()
    for (const definedSignal of definedSignals) {
        if (definedSignal.aborted) {
            controller.abort(definedSignal.reason)
            break
        }
        definedSignal.addEventListener('abort', () => controller.abort(definedSignal.reason), { once: true })
    }
    return controller.signal
}

export const transport = {
    request,
}

export type RequestOptions = {
    url: string
    method: string
    apiKey: string
    timeoutMs: number
    maxAttempts: number
    baseDelayMs: number
    maxDelayMs: number
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal
    retryable?: boolean
    idempotencyKey?: string
}

export type PerformRequestOptions = {
    url: string
    method: string
    apiKey: string
    timeoutMs: number
    body?: unknown
    headers?: Record<string, string>
    signal?: AbortSignal
    idempotencyKey?: string
}
