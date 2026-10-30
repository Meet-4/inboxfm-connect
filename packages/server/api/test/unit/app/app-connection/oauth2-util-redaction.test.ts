import { AppConnection, AppConnectionStatus, AppConnectionType, AppConnectionValue, OAuth2GrantType } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Secret exposure (engine boundary): oauth2Util.removeRefreshTokenAndClientSecret
// redacts refresh_token for every OAuth2 family value handed back by
// appConnectionService.getOne — the value the worker controller
// (GET /v1/app-connections/:externalId, engine-token-guarded) ships to the
// engine after resolving secret-manager references. But it redacted
// client_secret ONLY for OAUTH2 + CLIENT_CREDENTIALS, so authorization-code
// connections carried the user's client secret (secret-manager-resolved to the
// live value by the worker controller) across the engine boundary. No piece or
// framework code reads client_secret from auth — the server-side refresh
// re-resolves it itself — so it must be redacted for every OAuth2 family
// value that carries one.

vi.mock('../../../../src/app/ee/secret-managers/secret-managers.service', () => ({
    secretManagersService: () => ({ resolveObject: async ({ value }: { value: unknown }) => value }),
    containsSecretManagerReference: () => false,
}))
vi.mock('../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: () => ({ getOrThrow: async () => ({ version: '0.0.1' }) }),
    getPiecePackageWithoutArchive: vi.fn(),
}))

const mockLog: FastifyBaseLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
    silent: vi.fn(),
    level: 'info',
} as unknown as FastifyBaseLogger

type Oauth2Util = ReturnType<typeof import('../../../../src/app/app-connection/app-connection-service/oauth2/oauth2-util').oauth2Util>

async function loadUtil(): Promise<Oauth2Util> {
    const mod = await import('../../../../src/app/app-connection/app-connection-service/oauth2/oauth2-util')
    return mod.oauth2Util(mockLog)
}

const connection = (value: AppConnectionValue): AppConnection =>
    ({
        id: 'conn-1',
        externalId: 'ext-1',
        type: value.type,
        scope: 'PROJECT',
        pieceName: 'slack',
        displayName: 'Conn',
        projectIds: ['proj-1'],
        platformId: 'platform-1',
        status: AppConnectionStatus.ACTIVE,
        ownerId: 'user-1',
        owner: null,
        value,
        metadata: null,
        pieceVersion: '0.0.1',
        preSelectForNewProjects: false,
    }) as unknown as AppConnection

describe('oauth2Util.removeRefreshTokenAndClientSecret', () => {
    let util: Oauth2Util

    beforeEach(async () => {
        vi.clearAllMocks()
        vi.resetModules()
        util = await loadUtil()
    })

    it('redacts refresh_token AND client_secret for authorization-code oauth2 connections', async () => {
        const redacted = util.removeRefreshTokenAndClientSecret(connection({
            type: AppConnectionType.OAUTH2,
            grant_type: OAuth2GrantType.AUTHORIZATION_CODE,
            access_token: 'access-token-1',
            refresh_token: 'user-refresh-token',
            client_id: 'user-client-id',
            client_secret: 'user-client-secret',
            token_type: 'bearer',
            expires_in: 3600,
            claimed_at: 12345,
            scope: 'read',
            token_url: 'https://provider.example/token',
            redirect_url: 'https://app.example/redirect',
            data: {},
        }))

        expect(redacted.value).toMatchObject({
            access_token: 'access-token-1',
            refresh_token: '(REDACTED)',
            client_secret: '(REDACTED)',
        })
    })

    it('keeps redacting both secrets for client-credentials oauth2 connections', async () => {
        const redacted = util.removeRefreshTokenAndClientSecret(connection({
            type: AppConnectionType.OAUTH2,
            grant_type: OAuth2GrantType.CLIENT_CREDENTIALS,
            access_token: 'access-token-1',
            refresh_token: 'user-refresh-token',
            client_id: 'user-client-id',
            client_secret: 'user-client-secret',
            token_type: 'bearer',
            expires_in: 3600,
            claimed_at: 12345,
            scope: 'read',
            token_url: 'https://provider.example/token',
            redirect_url: 'https://app.example/redirect',
            data: {},
        }))

        expect(redacted.value).toMatchObject({
            refresh_token: '(REDACTED)',
            client_secret: '(REDACTED)',
        })
    })

    it('redacts a stray client secret on legacy platform oauth2 rows', async () => {
        // Rows claimed before the platform-claim stripping fix still carry the
        // platform app secret in their value — the engine boundary must not
        // leak those either.
        const redacted = util.removeRefreshTokenAndClientSecret(connection({
            type: AppConnectionType.PLATFORM_OAUTH2,
            access_token: 'access-token-1',
            refresh_token: 'user-refresh-token',
            client_id: 'platform-client-id',
            client_secret: 'platform-app-secret',
            token_type: 'bearer',
            expires_in: 3600,
            claimed_at: 12345,
            scope: 'read',
            token_url: 'https://provider.example/token',
            redirect_url: 'https://app.example/redirect',
            data: {},
        } as unknown as AppConnectionValue))

        expect(redacted.value).toMatchObject({
            refresh_token: '(REDACTED)',
            client_secret: '(REDACTED)',
        })
    })

    it('cloud oauth2 values keep their refresh token redacted and tolerate having no client secret', async () => {
        const redacted = util.removeRefreshTokenAndClientSecret(connection({
            type: AppConnectionType.CLOUD_OAUTH2,
            access_token: 'access-token-1',
            refresh_token: 'user-refresh-token',
            client_id: 'cloud-client-id',
            token_type: 'bearer',
            expires_in: 3600,
            claimed_at: 12345,
            scope: 'read',
            token_url: 'https://provider.example/token',
            data: {},
        }))

        expect(redacted.value).toMatchObject({
            access_token: 'access-token-1',
            refresh_token: '(REDACTED)',
        })
        expect('client_secret' in redacted.value).toBe(false)
    })

    it('strips token secrets duplicated inside the legacy data echo', async () => {
        // Rows written while formatOAuth2Response's data echo still duplicated
        // the provider response carry the token fields inside `data` — the
        // engine boundary must strip them too, while keeping the piece-facing
        // extras (Zoho's api_domain).
        const redacted = util.removeRefreshTokenAndClientSecret(connection({
            type: AppConnectionType.OAUTH2,
            grant_type: OAuth2GrantType.AUTHORIZATION_CODE,
            access_token: 'access-token-1',
            refresh_token: 'user-refresh-token',
            client_id: 'user-client-id',
            client_secret: 'user-client-secret',
            token_type: 'bearer',
            expires_in: 3600,
            claimed_at: 12345,
            scope: 'read',
            token_url: 'https://provider.example/token',
            redirect_url: 'https://app.example/redirect',
            data: {
                access_token: 'access-token-1',
                refresh_token: 'user-refresh-token',
                expires_in: 3600,
                scope: 'read',
                token_type: 'bearer',
                api_domain: 'https://accounts.zoho.com',
            },
        }))

        const data = (redacted.value as unknown as { data: Record<string, unknown> }).data
        expect(data).toMatchObject({ api_domain: 'https://accounts.zoho.com' })
        expect(data).not.toHaveProperty('access_token')
        expect(data).not.toHaveProperty('refresh_token')
        expect(data).not.toHaveProperty('expires_in')
        expect(data).not.toHaveProperty('scope')
        expect(data).not.toHaveProperty('token_type')
    })

    it('leaves non-oauth2 values untouched', async () => {
        const redacted = util.removeRefreshTokenAndClientSecret(connection({ type: AppConnectionType.NO_AUTH } as AppConnectionValue))

        expect(redacted.value).toEqual({ type: AppConnectionType.NO_AUTH })
    })
})

describe('oauth2Util.formatOAuth2Response', () => {
    let util: Oauth2Util

    beforeEach(async () => {
        vi.clearAllMocks()
        vi.resetModules()
        util = await loadUtil()
    })

    it('does not duplicate token fields into the stored data echo', async () => {
        // `data` exists so pieces can read non-token provider extras (e.g.
        // Zoho's api_domain) at runtime. The token fields were supposed to be
        // stripped from the echo, but core-utils' deleteProps returns a new
        // object instead of mutating, so the old call was a silent no-op and
        // every stored OAuth2 value duplicated the provider's full response —
        // refresh token included — into `data`.
        const formatted = util.formatOAuth2Response({
            access_token: 'access-token-1',
            refresh_token: 'refresh-token-1',
            expires_in: 3600,
            scope: 'read',
            token_type: 'bearer',
            client_id: 'user-client-id',
            token_url: 'https://provider.example/token',
            api_domain: 'https://accounts.zoho.com',
        } as unknown as Parameters<Oauth2Util['formatOAuth2Response']>[0])

        // Top-level fields the connection needs stay intact.
        expect(formatted.access_token).toBe('access-token-1')
        expect(formatted.refresh_token).toBe('refresh-token-1')
        expect(formatted.claimed_at).toBeGreaterThan(0)

        // The data echo keeps provider extras but none of the token fields.
        expect(formatted.data).not.toHaveProperty('access_token')
        expect(formatted.data).not.toHaveProperty('refresh_token')
        expect(formatted.data).not.toHaveProperty('expires_in')
        expect(formatted.data).not.toHaveProperty('scope')
        expect(formatted.data).not.toHaveProperty('token_type')
        expect(formatted.data.api_domain).toBe('https://accounts.zoho.com')
    })
})
