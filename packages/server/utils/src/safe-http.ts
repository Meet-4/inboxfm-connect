import http from 'node:http'
import https from 'node:https'
import { isNil } from '@inboxfm-connect/core-utils';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios'
import axiosRetry from 'axios-retry'
import { RequestFilteringHttpAgent, RequestFilteringHttpsAgent } from 'request-filtering-agent'

export function parseAllowListFromEnv(): string[] {
    const raw = process.env['AP_SSRF_ALLOW_LIST']
    if (!raw) return []
    return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function buildAgents({ allowList, httpAgentOptions, httpsAgentOptions }: BuildAgentsParams): SsrfAgents {
    const filteringOptions = {
        keepAlive: true,
        allowIPAddressList: allowList,
    }
    const pinnedSecurityOptions = {
        allowPrivateIPAddress: false,
        allowLoopbackIPAddress: false,
        allowMetaIPAddress: false,
    }
    return {
        httpAgent: new RequestFilteringHttpAgent({
            ...filteringOptions,
            ...httpAgentOptions,
            ...pinnedSecurityOptions,
        }),
        httpsAgent: new RequestFilteringHttpsAgent({
            ...filteringOptions,
            ...httpsAgentOptions,
            ...pinnedSecurityOptions,
        }),
    }
}

/**
 * `fetch`-shaped adapter over the SSRF-filtered axios client.
 *
 * Third-party SDKs that speak the WHATWG `fetch` API (AI SDK providers, the MCP client
 * transport) default to `globalThis.fetch`, which has no SSRF filtering at all. Handing
 * them the global fetch therefore silently opts that code path out of the guard: a
 * hostname is only judged at connect time by the egress agent, so a name that resolves
 * to a private/loopback/metadata address reaches it unchecked. Routing those SDKs
 * through this adapter keeps the resolution inside `request-filtering-agent`, where the
 * peer address is checked on every request (including each redirect hop).
 */
function createSafeFetch(fetchOptions: SafeFetchOptions = {}): SafeFetchFn {
    const client = createAxios({
        timeout: fetchOptions.timeoutMs ?? DEFAULT_SAFE_FETCH_TIMEOUT_MS,
        maxContentLength: fetchOptions.maxResponseBytes ?? DEFAULT_SAFE_FETCH_MAX_BYTES,
        maxBodyLength: fetchOptions.maxResponseBytes ?? DEFAULT_SAFE_FETCH_MAX_BYTES,
        responseType: 'arraybuffer',
        validateStatus: () => true,
    })
    return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const response = await client.request<ArrayBuffer>({
            url: resolveFetchUrl(input),
            method: init?.method ?? 'GET',
            headers: collectFetchHeaders(input, init),
            data: init?.body ?? undefined,
            signal: init?.signal ?? undefined,
            responseType: 'arraybuffer',
            validateStatus: () => true,
        })
        // axios already transparently decoded any content-encoding; forwarding the header
        // (or the pre-decoding content-length) would make the consumer decode twice or
        // truncate the body it reads.
        const headers = new Headers(normalizeResponseHeaders(response.headers as Record<string, unknown>))
        headers.delete('content-encoding')
        headers.delete('content-length')
        headers.delete('transfer-encoding')
        return new Response(response.data, {
            status: response.status,
            statusText: response.statusText,
            headers,
        })
    }
}

function resolveFetchUrl(input: string | URL | Request): string {
    if (typeof input === 'string') return input
    if (input instanceof URL) return input.toString()
    return input.url
}

function collectFetchHeaders(input: string | URL | Request, init?: RequestInit): Record<string, string> {
    const headers: Record<string, string> = {}
    if (input instanceof Request) {
        input.headers.forEach((value, key) => {
            headers[key] = value
        })
    }
    const initHeaders = init?.headers
    if (initHeaders instanceof Headers) {
        initHeaders.forEach((value, key) => {
            headers[key] = value
        })
    }
    else if (Array.isArray(initHeaders)) {
        for (const [key, value] of initHeaders) {
            headers[key] = value
        }
    }
    else if (initHeaders !== undefined) {
        Object.assign(headers, initHeaders)
    }
    return headers
}

function normalizeResponseHeaders(headers: Record<string, unknown>): Record<string, string> {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            normalized[key] = value
        }
        else if (typeof value === 'number' || typeof value === 'boolean') {
            normalized[key] = String(value)
        }
        else if (Array.isArray(value)) {
            normalized[key] = value.map(String).join(', ')
        }
    }
    return normalized
}

function isSsrfFilterError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const message = typeof error.message === 'string' ? error.message : ''
    const cause = error.cause instanceof Error ? error.cause.message : ''
    return SSRF_FILTER_MESSAGE_REGEX.test(message) || SSRF_FILTER_MESSAGE_REGEX.test(cause)
}

function attachSsrfErrorInterceptor(instance: AxiosInstance): AxiosInstance {
    instance.interceptors.response.use(undefined, (error: unknown) => {
        if (isSsrfFilterError(error)) {
            const original = error instanceof Error ? error.message : String(error)
            const enriched = `${original} — ${SSRF_REMEDIATION_HINT}`
            if (error instanceof Error) error.message = enriched
        }
        return Promise.reject(error)
    })
    return instance
}

// Issue #371: axios's default is NO timeout, so any safeHttp caller that forgets
// an explicit timeout can hang its request handler indefinitely on a stalled
// upstream. Bound that here with a conservative default; an explicit caller
// value still wins because ...config spreads after it.
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
// Same ceilings the hand-rolled guarded fetch adapters in the api package used, so moving
// an SDK onto this helper cannot quietly widen its response budget.
const DEFAULT_SAFE_FETCH_TIMEOUT_MS = 30_000
const DEFAULT_SAFE_FETCH_MAX_BYTES = 10 * 1024 * 1024

function createAxios(config?: AxiosRequestConfig, { httpAgentOptions, httpsAgentOptions }: SafeAxiosOptions = {}): AxiosInstance {
    const { httpAgent, httpsAgent } = buildAgents({
        allowList: parseAllowListFromEnv(),
        httpAgentOptions,
        httpsAgentOptions,
    })
    return attachSsrfErrorInterceptor(axios.create({
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
        ...config,
        httpAgent,
        httpsAgent,
    }))
}

function createRetryingAxios(config?: AxiosRequestConfig, options?: SafeAxiosOptions): AxiosInstance {
    const instance = createAxios(config, options)
    axiosRetry(instance, {
        retries: 3,
        retryDelay: () => 2000,
        retryCondition: (error: AxiosError) =>
            !isNil(error.response?.status) && error.response.status >= 500 && error.response.status < 600,
    })
    return instance
}

let lazyDefaultAxios: AxiosInstance | undefined
let lazyRetryingAxios: AxiosInstance | undefined

const SSRF_FILTER_MESSAGE_REGEX = /(DNS lookup .* not allowed|IP .* is not allowed)/i
const SSRF_REMEDIATION_HINT = 'the target is blocked by the SSRF filter. If it is a trusted internal host (e.g. a self-hosted Vault, Conjur, or OAuth2 provider), add its IP or CIDR to the AP_SSRF_ALLOW_LIST environment variable (comma-separated) and restart the server.'

export const safeHttp = {
    buildAgents,
    createAxios,
    createRetryingAxios,
    createSafeFetch,
    get axios(): AxiosInstance {
        lazyDefaultAxios ??= createAxios()
        return lazyDefaultAxios
    },
    get retryingAxios(): AxiosInstance {
        lazyRetryingAxios ??= createRetryingAxios()
        return lazyRetryingAxios
    },
}

export type SsrfAgents = {
    httpAgent: http.Agent
    httpsAgent: https.Agent
}

export type SafeAxiosOptions = {
    httpAgentOptions?: http.AgentOptions
    httpsAgentOptions?: http.AgentOptions
}

export type SafeFetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type SafeFetchOptions = {
    timeoutMs?: number
    maxResponseBytes?: number
}

type BuildAgentsParams = {
    allowList: string[]
    httpAgentOptions?: http.AgentOptions
    httpsAgentOptions?: https.AgentOptions
}
