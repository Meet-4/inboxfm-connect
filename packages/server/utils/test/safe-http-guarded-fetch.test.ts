import http from 'node:http'
import { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { safeHttp } from '../src/safe-http'

/**
 * `safeHttp.createSafeFetch` is the adapter handed to third-party SDKs that insist on the
 * WHATWG fetch API. Its whole reason to exist is that the SSRF decision must be made at
 * connect time: a hostname is judged by `request-filtering-agent` when it resolves, not by
 * the URL's spelling. These tests pin that behaviour against a real loopback listener, so a
 * future refactor back to `globalThis.fetch` (or to an agent without the filtering options)
 * fails here instead of silently re-opening the hole.
 */
describe('safeHttp.createSafeFetch — request-time egress filtering', () => {
    let server: http.Server | null = null

    afterEach(async () => {
        if (server !== null) {
            await new Promise<void>((resolve) => server!.close(() => resolve()))
            server = null
        }
        delete process.env['AP_SSRF_ALLOW_LIST']
    })

    async function startListener(): Promise<{ baseUrl: string, hits: Array<{ method?: string, url?: string, body: string }> }> {
        const hits: Array<{ method?: string, url?: string, body: string }> = []
        server = http.createServer((req, res) => {
            const chunks: Buffer[] = []
            req.on('data', (chunk: Buffer) => chunks.push(chunk))
            req.on('end', () => {
                hits.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString('utf8') })
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end(JSON.stringify({ ok: true }))
            })
        })
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
        const { port } = server!.address() as AddressInfo
        return { baseUrl: `http://127.0.0.1:${port}`, hits }
    }

    it('refuses a loopback target and never puts a request on the wire', async () => {
        const { baseUrl, hits } = await startListener()
        const guardedFetch = safeHttp.createSafeFetch()

        await expect(guardedFetch(`${baseUrl}/v1/chat/completions`)).rejects.toThrow(/not allowed/i)

        expect(hits).toHaveLength(0)
    })

    it('performs the request (method, body, headers intact) once the host is allow-listed', async () => {
        const { baseUrl, hits } = await startListener()
        // The agent reads the allow-list when it is built, so set it before creating the fetch.
        process.env['AP_SSRF_ALLOW_LIST'] = '127.0.0.1'
        const guardedFetch = safeHttp.createSafeFetch()

        const response = await guardedFetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'authorization': 'Bearer sk-test' },
            body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ ok: true })
        expect(hits).toHaveLength(1)
        expect(hits[0].method).toBe('POST')
        expect(hits[0].url).toBe('/v1/chat/completions')
        expect(JSON.parse(hits[0].body)).toEqual({ model: 'gpt-4o', messages: [] })
    })
})
