import http from 'node:http'
import { AddressInfo } from 'node:net'
import { AIProviderName } from '@inboxfm-connect/core-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The CUSTOM provider is the one chat provider whose host comes from platform config, and the
 * platform's API key is attached to every request. `assertCustomProviderEgressAllowed` only
 * rejects targets the URL spells out as a blocked IP literal (or localhost): DNS names are
 * deliberately deferred to "the egress agent at connect time". That deferral is only sound if the
 * provider is actually built with the SSRF-filtered fetch — the AI SDK's default is
 * `globalThis.fetch`, which resolves the name itself, so a hostname pointing at
 * 169.254.169.254 / 127.0.0.1 / 10.x would leak the key and return the response to the caller.
 *
 * These tests pin the wiring at the SDK boundary (the settings the provider is constructed with)
 * and then exercise the captured fetch against a real loopback listener.
 */
const captured = vi.hoisted(() => ({ settings: [] as Array<Record<string, unknown>> }))

vi.mock('@ai-sdk/openai-compatible', () => ({
    createOpenAICompatible: (settings: Record<string, unknown>) => {
        captured.settings.push(settings)
        return {
            chatModel: (modelId: string) => ({ modelId, provider: 'openai-compatible' }),
        }
    },
}))

// Imported after the mock so the module graph picks up the stub.
import { chatAiUtils } from '../src/chat-ai-utils'

const AUTH = { apiKey: 'sk-secret' }

function buildCustomModel(baseUrl: string): void {
    chatAiUtils.createChatModel({
        provider: AIProviderName.CUSTOM,
        auth: AUTH,
        config: { apiKeyHeader: 'Authorization', baseUrl },
        modelId: 'gpt-4o',
    })
}

describe('CUSTOM provider — the built client must not use the global fetch', () => {
    let server: http.Server | null = null

    afterEach(async () => {
        if (server !== null) {
            await new Promise<void>((resolve) => server!.close(() => resolve()))
            server = null
        }
        captured.settings.length = 0
        delete process.env['AP_SSRF_ALLOW_LIST']
    })

    async function startListener(): Promise<{ baseUrl: string, hits: string[] }> {
        const hits: string[] = []
        server = http.createServer((req, res) => {
            req.on('data', () => undefined)
            req.on('end', () => {
                hits.push(req.url ?? '')
                res.writeHead(200, { 'content-type': 'application/json' })
                res.end('{}')
            })
        })
        await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()))
        const { port } = server!.address() as AddressInfo
        return { baseUrl: `http://127.0.0.1:${port}`, hits }
    }

    it('passes an SSRF-filtered fetch to the provider', () => {
        buildCustomModel('https://gateway.vendor.example/v1')

        expect(captured.settings).toHaveLength(1)
        expect(typeof captured.settings[0]['fetch']).toBe('function')
    })

    it('that fetch blocks a target which resolves to a private/loopback address', async () => {
        const { baseUrl, hits } = await startListener()
        buildCustomModel('https://gateway.vendor.example/v1')
        const providerFetch = captured.settings[0]['fetch'] as typeof fetch

        // Positive control: the listener is reachable, so an unguarded client would get through.
        const plainResponse = await fetch(`${baseUrl}/v1/models`)
        expect(plainResponse.status).toBe(200)
        expect(hits).toHaveLength(1)

        await expect(providerFetch(`${baseUrl}/v1/models`)).rejects.toThrow(/not allowed/i)
        expect(hits).toHaveLength(1)
    })
})
