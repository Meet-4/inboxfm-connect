import { createServer, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundleHttp } from '../../../../src/lib/utils/bundle-http'

let server: Server
let baseUrl: string

beforeAll(async () => {
    server = createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('bundleHttp.getBuffer size cap', () => {
    it('rejects a streamed body larger than the cap instead of buffering it all', async () => {
        const oversizedBody = 'x'.repeat(256 * 1024)
        server.on('request', (req, res) => {
            if (req.url === '/oversized') {
                // No Content-Length — chunked transfer, so only the streamed
                // byte counter can catch it.
                res.writeHead(200, { 'content-type': 'application/octet-stream' })
                res.end(oversizedBody)
            }
        })

        // A 256KB body must be rejected under a 16KB cap.
        await expect(bundleHttp.getBuffer(`${baseUrl}/oversized`, 16 * 1024))
            .rejects.toThrow(/aborted.*more than 16384 bytes|exceeds the maximum/i)
    })

    it('rejects from Content-Length alone without reading the body', async () => {
        server.on('request', (req, res) => {
            if (req.url === '/lying-content-length') {
                res.writeHead(200, { 'content-length': String(1024 * 1024) })
                // Never send the body — the reader would hang if the cap were
                // enforced only while streaming.
                res.flushHeaders()
            }
        })

        await expect(bundleHttp.getBuffer(`${baseUrl}/lying-content-length`, 16 * 1024))
            .rejects.toThrow(/exceeds/i)
    })

    it('returns a body under the cap byte-for-byte', async () => {
        const body = 'y'.repeat(8 * 1024)
        server.on('request', (req, res) => {
            if (req.url === '/small') {
                res.writeHead(200, { 'content-length': String(body.length) })
                res.end(body)
            }
        })

        const buffer = await bundleHttp.getBuffer(`${baseUrl}/small`, 16 * 1024)
        expect(buffer.toString()).toBe(body)
    })

    it('throws on non-2xx responses', async () => {
        server.on('request', (req, res) => {
            if (req.url === '/missing') {
                res.writeHead(404)
                res.end()
            }
        })

        await expect(bundleHttp.getBuffer(`${baseUrl}/missing`, 16 * 1024)).rejects.toThrow(/404/)
    })
})
