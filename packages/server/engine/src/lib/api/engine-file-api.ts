import { promisify } from 'node:util'
import { zstdDecompress as zstdDecompressCallback } from 'node:zlib'
import { EngineFileNotFoundError, EngineGenericError, FileCompression, FileType, isZstdCompressed } from '@inboxfm-connect/shared'
import fetchRetry from 'fetch-retry'

const zstdDecompress = promisify(zstdDecompressCallback)

// fetch-retry v6 defaults `retryOn: []`, which NEVER retries on an HTTP status —
// only network-level failures — so `retries: 3` below never applied to a 502/503
// from a restarting API: the request failed on the very first response. Retry
// the transient statuses explicitly. Every 4xx stays terminal (404/410 map to
// EngineFileNotFoundError, other client errors to EngineGenericError), so a bad
// request can never be retried forever. Retry-After on 429s is not honored;
// the backoff below is the wait budget instead.
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504]

const RETRY_CONFIG = {
    retries: 3,
    retryOn: RETRYABLE_STATUS_CODES,
    // Exponential backoff with ±20% jitter: a flat delay puts every sandbox
    // engine retrying in lockstep against an API that just came back — the
    // thundering herd the retry is trying to recover from. attempt is 0-based,
    // so the delays are ~2.4s / ~4.8s / ~9.6s at the jitter floor.
    retryDelay: (attempt: number): number => Math.round(3000 * 2 ** attempt * (0.8 + 0.4 * Math.random())),
} as const

const READ_URL_HEADER = 'x-ap-file-read-url'
const FILE_TYPE_HEADER = 'x-ap-file-type'
const FILE_NAME_HEADER = 'x-ap-file-name'

export const engineFileApi = {
    async upload({ engineToken, apiUrl, fileId, type, fileName, compression, data }: UploadParams): Promise<UploadResult> {
        const fetchWithRetry = fetchRetry(global.fetch)
        const headers = buildPutHeaders({ type, fileName, compression, contentLength: data.length })
        const baseApiUrl = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`
        const putUrl = `${baseApiUrl}v1/files/${fileId}?token=${encodeURIComponent(engineToken)}`

        const initial = await fetchWithRetry(putUrl, {
            method: 'PUT',
            body: data,
            headers,
            redirect: 'manual',
            ...RETRY_CONFIG,
        })

        const readUrlFromHeader = initial.headers.get(READ_URL_HEADER) ?? undefined

        if (initial.status >= 300 && initial.status < 400) {
            const location = initial.headers.get('location')
            if (!location) {
                throw new EngineGenericError('EngineFileUploadError', 'Server returned a redirect without a Location header')
            }
            const s3Response = await fetchWithRetry(location, {
                method: 'PUT',
                body: data,
                headers: stripApHeaders(headers),
                redirect: 'follow',
                ...RETRY_CONFIG,
            })
            if (!s3Response.ok) {
                throw new EngineGenericError(
                    'EngineFileUploadError',
                    `Failed to upload to signed S3 URL for ${fileId}: ${s3Response.status} ${s3Response.statusText}`,
                )
            }
            if (!readUrlFromHeader) {
                throw new EngineGenericError('EngineFileUploadError', `Server redirect response missing ${READ_URL_HEADER} header`)
            }
            return { fileId, readUrl: readUrlFromHeader }
        }

        if (!initial.ok) {
            throw new EngineGenericError(
                'EngineFileUploadError',
                `Failed to upload engine file ${fileId}: ${initial.status} ${initial.statusText}`,
            )
        }

        if (readUrlFromHeader) {
            return { fileId, readUrl: readUrlFromHeader }
        }
        const body = await initial.json() as { readUrl?: unknown }
        if (typeof body.readUrl !== 'string') {
            throw new EngineGenericError('EngineFileUploadError', 'Upload response missing readUrl')
        }
        return { fileId, readUrl: body.readUrl }
    },
    async download({ engineToken, apiUrl, fileId }: DownloadFileParams): Promise<Uint8Array> {
        const fetchWithRetry = fetchRetry(global.fetch)
        const baseApiUrl = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`
        const response = await fetchWithRetry(`${baseApiUrl}v1/files/${fileId}?token=${encodeURIComponent(engineToken)}`, {
            method: 'GET',
            redirect: 'follow',
            ...RETRY_CONFIG,
        })
        if (!response.ok) {
            // A gone file (deleted/expired trigger payload or run log) never recovers on retry and is a
            // data-lifecycle issue, not an engine bug — surface it as a USER error so callers can fail the
            // run cleanly. Other non-ok statuses (5xx, throttling) may be transient, so keep them ENGINE.
            if (response.status === 404 || response.status === 410) {
                throw new EngineFileNotFoundError(fileId)
            }
            throw new EngineGenericError(
                'EngineFileDownloadError',
                `Failed to download file ${fileId}: ${response.status} ${response.statusText}`,
            )
        }
        const raw = new Uint8Array(await response.arrayBuffer())
        // The server's proxy path runs the file through fileCompressor.decompress before
        // streaming it back, but the S3 signed-URL redirect path serves the stored bytes
        // straight from S3 — which for FLOW_RUN_LOG is zstd-compressed. Native fetch does
        // not auto-decompress zstd, so callers (RESUME hydration, slice materialization)
        // would crash on JSON.parse. Detect the magic bytes and decompress here so the
        // download contract is "always returns the original payload" regardless of which
        // server path served it.
        if (isZstdCompressed(raw)) {
            return new Uint8Array(await zstdDecompress(Buffer.from(raw)))
        }
        return raw
    },
}

function buildPutHeaders({ type, fileName, compression, contentLength }: BuildHeadersParams): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(contentLength),
        [FILE_TYPE_HEADER]: type,
    }
    if (fileName) {
        headers[FILE_NAME_HEADER] = fileName
    }
    if (compression === FileCompression.ZSTD) {
        headers['Content-Encoding'] = 'zstd'
    }
    return headers
}

function stripApHeaders(headers: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        if (!key.toLowerCase().startsWith('x-ap-')) {
            result[key] = value
        }
    }
    return result
}

type UploadParams = {
    engineToken: string
    apiUrl: string
    fileId: string
    type: FileType.FLOW_STEP_FILE | FileType.FLOW_RUN_LOG | FileType.FLOW_RUN_LOG_SLICE
    fileName?: string
    compression?: FileCompression
    data: Uint8Array | Buffer
}

type UploadResult = {
    fileId: string
    readUrl: string
}

type DownloadFileParams = {
    engineToken: string
    apiUrl: string
    fileId: string
}

type BuildHeadersParams = {
    type: FileType
    fileName?: string
    compression?: FileCompression
    contentLength: number
}
