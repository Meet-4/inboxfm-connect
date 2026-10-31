import { describe, expect, it } from 'vitest'
import { connectErrorFactory } from '../src/errors'

function jsonResponse({ status, body, headers }: { status: number, body: unknown, headers?: Record<string, string> }): Response {
    return new Response(JSON.stringify(body), { status, headers })
}

describe('connectErrorFactory.fromResponse', () => {
    it('categorizes a 401 as authentication', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 401, body: { code: 'INVALID_BEARER_TOKEN', params: {} } }),
        })
        expect(error.category).toBe('authentication')
        expect(error.code).toBe('INVALID_BEARER_TOKEN')
        expect(error.retryable).toBe(false)
    })

    it('categorizes a 404 as not_found', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 404, body: { code: 'ENTITY_NOT_FOUND', params: {} } }),
        })
        expect(error.category).toBe('not_found')
    })

    it('distinguishes 409 validation from other 409 conflicts', async () => {
        const validationError = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 409, body: { code: 'VALIDATION', params: {} } }),
        })
        expect(validationError.category).toBe('validation')

        const conflictError = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 409, body: { code: 'EXISTING_USER', params: {} } }),
        })
        expect(conflictError.category).toBe('conflict')
    })

    it('categorizes a 429 as rate_limit and marks it retryable with retry-after', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({
                status: 429,
                body: { code: 'PROJECT_RATE_LIMIT_EXCEEDED', params: {} },
                headers: { 'Retry-After': '2' },
            }),
        })
        expect(error.category).toBe('rate_limit')
        expect(error.retryable).toBe(true)
        expect(error.retryAfterMs).toBe(2000)
    })

    it('categorizes a 500 as server and retryable', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 500, body: { message: 'boom' } }),
        })
        expect(error.category).toBe('server')
        expect(error.retryable).toBe(true)
    })

    it('never includes the Authorization header or api key in the serialized error', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 500, body: { message: 'boom' } }),
        })
        const serialized = JSON.stringify(error.toJSON())
        expect(serialized).not.toContain('Authorization')
        expect(serialized).not.toContain('Bearer')
    })
})

describe('server error body shapes (the reason must not be dropped)', () => {
    it('extracts the real reason from ActivepiecesError bodies ({ code, params } with no top-level message)', async () => {
        // This is the exact shape the server's error handler serializes
        // (`app/helper/error-handler.ts`): `{ code, params }` — there is no
        // top-level `message` field. The reason lives at `params.message`.
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({
                status: 400,
                body: { code: 'ENGINE_OPERATION_FAILURE', params: { message: 'Piece slack failed: channel not found' } },
            }),
        })

        expect(error.code).toBe('ENGINE_OPERATION_FAILURE')
        expect(error.params).toEqual({ message: 'Piece slack failed: channel not found' })
        expect(error.message).toBe('Piece slack failed: channel not found')
    })

    it('extracts params.error for INVALID_APP_CONNECTION bodies', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({
                status: 400,
                body: { code: 'INVALID_APP_CONNECTION', params: { error: 'Connection type "OAUTH2" is not supported through a connect session' } },
            }),
        })

        expect(error.message).toBe('Connection type "OAUTH2" is not supported through a connect session')
    })

    it('keeps a top-level message winning over the nested params reason', async () => {
        // Fastify-generated errors (zod validation) put the reason at the top level;
        // when both shapes appear, that message is the authoritative one.
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({
                status: 422,
                body: { message: 'body must match the schema', code: 'VALIDATION', params: {} },
            }),
        })

        expect(error.message).toBe('body must match the schema')
    })

    it('falls back to the generic status string when the body carries no readable reason', async () => {
        // INVALID_CREDENTIALS sends `params: null` — nothing readable anywhere.
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 401, body: { code: 'INVALID_CREDENTIALS', params: null } }),
        })

        expect(error.message).toBe('Inboxfm Connect API error (401)')
    })

    it('ignores non-string params.message values instead of leaking objects into the message', async () => {
        const error = await connectErrorFactory.fromResponse({
            response: jsonResponse({ status: 400, body: { code: 'ENTITY_NOT_FOUND', params: { message: { entityId: 'abc' } } } }),
        })

        expect(error.message).toBe('Inboxfm Connect API error (400)')
    })
})

describe('connectErrorFactory network/timeout/abort', () => {
    it('marks network errors as retryable', () => {
        const error = connectErrorFactory.fromNetworkError({ cause: new Error('ECONNRESET') })
        expect(error.category).toBe('network')
        expect(error.retryable).toBe(true)
    })

    it('marks timeouts as retryable', () => {
        const error = connectErrorFactory.fromTimeout({ timeoutMs: 5000 })
        expect(error.category).toBe('timeout')
        expect(error.retryable).toBe(true)
        expect(error.message).toContain('5000')
    })

    it('marks caller aborts as not retryable', () => {
        const error = connectErrorFactory.fromAbort()
        expect(error.category).toBe('aborted')
        expect(error.retryable).toBe(false)
    })
})
