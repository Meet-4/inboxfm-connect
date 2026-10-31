import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { fileProcessor } from '../../../src/lib/variables/processors/file'

const mockFetch = vi.fn()

vi.stubGlobal('fetch', mockFetch)

describe('fileProcessor URL download failure propagation', () => {
    beforeEach(() => {
        mockFetch.mockReset()
    })

    afterEach(() => {
        mockFetch.mockReset()
    })

    it('returns an ApFile for a 200 response', async () => {
        mockFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { 'content-type': 'image/png' },
        }))

        const result = await fileProcessor(undefined as never, 'https://example.com/logo.png')

        expect(result).toBeDefined()
        expect(result).not.toBeNull()
    })

    it('does NOT materialize a 404 response body as a valid file (failure must stay a failure)', async () => {
        mockFetch.mockResolvedValueOnce(new Response('<html>Not Found</html>', {
            status: 404,
            headers: { 'content-type': 'text/html' },
        }))

        const result = await fileProcessor(undefined as never, 'https://example.com/missing.png')

        expect(result).toBeNull()
    })

    it('does NOT materialize a 403 response body as a valid file', async () => {
        mockFetch.mockResolvedValueOnce(new Response('Forbidden', {
            status: 403,
            headers: { 'content-type': 'text/plain' },
        }))

        const result = await fileProcessor(undefined as never, 'https://example.com/private.png')

        expect(result).toBeNull()
    })

    it('does NOT materialize a 500 response body as a valid file', async () => {
        mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', {
            status: 500,
            headers: { 'content-type': 'text/plain' },
        }))

        const result = await fileProcessor(undefined as never, 'https://example.com/broken.png')

        expect(result).toBeNull()
    })

    it('returns null on a network error (existing lenient contract)', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'))

        const result = await fileProcessor(undefined as never, 'https://unreachable.example.com/x.png')

        expect(result).toBeNull()
    })

    it('still resolves a base64 data URL without fetching', async () => {
        const result = await fileProcessor(undefined as never, 'data:image/png;base64,iVBORw0KGgo=')

        expect(mockFetch).not.toHaveBeenCalled()
        expect(result).toBeDefined()
        expect(result).not.toBeNull()
    })
})
