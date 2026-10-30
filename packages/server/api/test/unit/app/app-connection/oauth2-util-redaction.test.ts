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

    it('leaves non-oauth2 values untouched', async () => {
        const redacted = util.removeRefreshTokenAndClientSecret(connection({ type: AppConnectionType.NO_AUTH } as AppConnectionValue))

        expect(redacted.value).toEqual({ type: AppConnectionType.NO_AUTH })
    })
})
