import { promisify } from 'node:util'
import { zstdCompress as zstdCompressCallback } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { engineFileApi } from '../src/lib/api/engine-file-api'

const zstdCompress = promisify(zstdCompressCallback)

const PARAMS = {
    engineToken: 'test-token',
    apiUrl: 'http://localhost:3000/',
    fileId: 'file-1',
}

const FILE_BYTES = new TextEncoder().encode(JSON.stringify({ hello: 'world' }))

describe('engineFileApi retry classification & backoff', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it('retries transient 5xx responses and succeeds once the API recovers', async () => {
        vi.useFakeTimers()
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
            .mockResolvedValueOnce(new Response('service unavailable', { status: 503 }))
            .mockResolvedValueOnce(new Response(FILE_BYTES, { status: 200 }))

        const pending = engineFileApi.download(PARAMS)
            .then(bytes => ({ ok: true as const, bytes }), (e): { ok: false, e: unknown } => ({ ok: false as const, e }))
        await vi.advanceTimersByTimeAsync(60_000)
        const result = await pending

        expect(result.ok).toBe(true)
        expect(fetchSpy).toHaveBeenCalledTimes(3)
    })

    it('does not retry terminal 4xx responses (403) — fails on the first response', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValue(new Response('forbidden', { status: 403 }))

        await expect(engineFileApi.download(PARAMS)).rejects.toThrow('Failed to download file')

        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('does not retry a gone file (404) and surfaces EngineFileNotFoundError', async () => {
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValue(new Response('not found', { status: 404 }))

        await expect(engineFileApi.download(PARAMS)).rejects.toThrow('File')

        expect(fetchSpy).toHaveBeenCalledTimes(1)
    })

    it('exhausts the configured retries on a persistent 5xx, then fails as an engine error', async () => {
        vi.useFakeTimers()
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValue(new Response('boom', { status: 500 }))

        const pending = engineFileApi.download(PARAMS)
            .then(v => ({ ok: true as const, v }), (e): { ok: false, e: unknown } => ({ ok: false as const, e }))
        await vi.advanceTimersByTimeAsync(60_000)
        const result = await pending

        expect(result.ok).toBe(false)
        expect(fetchSpy).toHaveBeenCalledTimes(4) // initial attempt + retries: 3
    })

    it('spaces retries with exponential backoff instead of one flat herd-inducing delay', async () => {
        vi.useFakeTimers()
        // Pin the jitter band to its floor so delay(attempt) = 3000 * 2^attempt * 0.8.
        vi.spyOn(Math, 'random').mockReturnValue(0)
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockResolvedValue(new Response('service unavailable', { status: 503 }))

        const pending = engineFileApi.download(PARAMS)
            .then(v => ({ ok: true as const, v }), (e): { ok: false, e: unknown } => ({ ok: false as const, e }))

        await vi.advanceTimersByTimeAsync(2_399)
        expect(fetchSpy).toHaveBeenCalledTimes(1) // first retry waits ≥ ~2.4s

        await vi.advanceTimersByTimeAsync(1)
        expect(fetchSpy).toHaveBeenCalledTimes(2) // first backoff step fired

        await vi.advanceTimersByTimeAsync(4_799)
        expect(fetchSpy).toHaveBeenCalledTimes(2) // second retry waits ≥ ~4.8s — backoff doubles

        await vi.advanceTimersByTimeAsync(1)
        expect(fetchSpy).toHaveBeenCalledTimes(3)

        await vi.advanceTimersByTimeAsync(60_000)
        const result = await pending
        expect(result.ok).toBe(false)
        expect(fetchSpy).toHaveBeenCalledTimes(4)
    })

    it('still retries network-level failures (existing behavior preserved)', async () => {
        vi.useFakeTimers()
        const fetchSpy = vi.spyOn(global, 'fetch')
            .mockRejectedValueOnce(new TypeError('fetch failed'))
            .mockResolvedValueOnce(new Response(FILE_BYTES, { status: 200 }))

        const pending = engineFileApi.download(PARAMS)
            .then(v => ({ ok: true as const, v }), (e): { ok: false, e: unknown } => ({ ok: false as const, e }))
        await vi.advanceTimersByTimeAsync(60_000)
        const result = await pending

        expect(result.ok).toBe(true)
        expect(fetchSpy).toHaveBeenCalledTimes(2)
    })
})

describe('engineFileApi.download zstd auto-decompression', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('returns plain bytes untouched when the server already decompressed', async () => {
        const plain = new TextEncoder().encode(JSON.stringify({ hello: 'world' }))
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(plain, { status: 200 }))

        const bytes = await engineFileApi.download(PARAMS)

        expect(new TextDecoder().decode(bytes)).toBe('{"hello":"world"}')
    })

    it('decompresses raw zstd bytes — covers the S3 signed-URL redirect path on RESUME', async () => {
        // Simulates the path where the server 307s to S3 and the engine receives the
        // file exactly as it was uploaded — zstd-compressed for FLOW_RUN_LOG.
        const original = Buffer.from(JSON.stringify({ executionState: { steps: { trigger: { output: { ok: true } } }, tags: [] } }))
        const compressed = await zstdCompress(original)
        vi.spyOn(global, 'fetch').mockResolvedValue(new Response(new Uint8Array(compressed), { status: 200 }))

        const bytes = await engineFileApi.download(PARAMS)

        expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
            executionState: { steps: { trigger: { output: { ok: true } } }, tags: [] },
        })
    })
})
