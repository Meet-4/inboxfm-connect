import { PropertyType } from '@inboxfm-connect/pieces-framework'
import { AppConnectionType, OAuth2GrantType } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Secret exposure (platform OAuth2): credentialsOauth2Service.claim returns the
// client secret it was given, and platformOAuth2Service.claim used to spread
// that claimed value straight into its return type. For platform connections
// the secret in question is the PLATFORM-WIDE OAuth app secret from
// oauth-apps, so it was copied into every project-scoped connection row
// created with that app (the upsert request DTO for platform connections has
// no client_secret field, so nothing overrides it). The refresh path proves
// the stored secret is never needed: it re-fetches it from oauth-apps on every
// refresh (getWithSecret) instead of reading the stored value. The claim must
// strip the secret at the boundary.

const mockGetWithSecret = vi.fn()
const mockCredentialsClaim = vi.fn()

vi.mock('../../../../src/app/pieces/metadata/piece-metadata-service', () => ({
    pieceMetadataService: () => ({
        getOrThrow: async () => ({
            auth: { type: PropertyType.OAUTH2 },
        }),
    }),
    getPiecePackageWithoutArchive: vi.fn(),
}))

vi.mock('../../../../src/app/ee/oauth-apps/oauth-app.service', () => ({
    oauthAppService: {
        getWithSecret: mockGetWithSecret,
    },
}))

vi.mock('../../../../src/app/app-connection/app-connection-service/oauth2/services/credentials-oauth2-service', () => ({
    credentialsOauth2Service: () => ({
        claim: mockCredentialsClaim,
    }),
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

type PlatformOAuth2Service = ReturnType<typeof import('../../../../src/app/ee/app-connections/platform-oauth2-service').platformOAuth2Service>

async function loadService(): Promise<PlatformOAuth2Service> {
    const mod = await import('../../../../src/app/ee/app-connections/platform-oauth2-service')
    return mod.platformOAuth2Service(mockLog)
}

const PLATFORM_APP_SECRET = 'platform-app-super-secret'

describe('platformOAuth2Service.claim must not persist the platform app secret', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()
        mockGetWithSecret.mockResolvedValue({
            id: 'oapp-1',
            pieceName: 'slack',
            platformId: 'platform-1',
            clientId: 'platform-client-id',
            clientSecret: PLATFORM_APP_SECRET,
        })
        // Mirrors the real credentialsOauth2Service.claim: the returned
        // connection value echoes the client secret it exchanged with.
        mockCredentialsClaim.mockImplementation(async ({ request }: { request: { clientId: string, clientSecret?: string, redirectUrl?: string, tokenUrl: string } }) => ({
            type: AppConnectionType.OAUTH2,
            access_token: 'access-token-1',
            expires_in: 3600,
            refresh_token: 'refresh-token-1',
            scope: 'read',
            token_type: 'bearer',
            claimed_at: 12345,
            token_url: request.tokenUrl,
            client_id: request.clientId,
            client_secret: request.clientSecret,
            redirect_url: request.redirectUrl,
            props: undefined,
            data: {},
        }))
    })

    it('strips the platform client secret from the claimed value', async () => {
        const service = await loadService()

        const claimed = await service.claim({
            projectId: 'project-1',
            platformId: 'platform-1',
            pieceName: 'slack',
            request: {
                code: 'auth-code-1',
                clientId: 'platform-client-id',
                tokenUrl: 'https://provider.example/token',
                redirectUrl: 'https://app.example/redirect',
                grantType: OAuth2GrantType.AUTHORIZATION_CODE,
            },
        })

        // The platform secret never leaves the claim boundary into the value
        // that appConnectionService.upsert persists.
        expect(claimed).not.toHaveProperty('client_secret')
        expect('client_secret' in (claimed as unknown as Record<string, unknown>)).toBe(false)

        // Everything the connection actually needs is intact.
        expect(claimed.type).toBe(AppConnectionType.PLATFORM_OAUTH2)
        expect(claimed.access_token).toBe('access-token-1')
        expect(claimed.refresh_token).toBe('refresh-token-1')
        expect(claimed.client_id).toBe('platform-client-id')
        expect(claimed.redirect_url).toBe('https://app.example/redirect')
    })

    it('still exchanges the code with the platform app credentials', async () => {
        const service = await loadService()

        await service.claim({
            projectId: 'project-1',
            platformId: 'platform-1',
            pieceName: 'slack',
            request: {
                code: 'auth-code-1',
                clientId: 'whatever-the-request-said',
                tokenUrl: 'https://provider.example/token',
                redirectUrl: 'https://app.example/redirect',
                grantType: OAuth2GrantType.AUTHORIZATION_CODE,
            },
        })

        // The token exchange runs with the platform-configured app
        // credentials (from oauth-apps), overriding any request-supplied ids.
        expect(mockGetWithSecret).toHaveBeenCalledWith({
            pieceName: 'slack',
            clientId: 'whatever-the-request-said',
            platformId: 'platform-1',
        })
        expect(mockCredentialsClaim).toHaveBeenCalledTimes(1)
        const innerRequest = mockCredentialsClaim.mock.calls[0][0].request
        expect(innerRequest.clientId).toBe('platform-client-id')
        expect(innerRequest.clientSecret).toBe(PLATFORM_APP_SECRET)
    })
})
