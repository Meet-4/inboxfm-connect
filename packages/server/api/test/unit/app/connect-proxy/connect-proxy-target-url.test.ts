import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectProxyErrorCode, BaseOAuth2ConnectionValue, SupportedProxyProvider } from '@inboxfm-connect/shared'
import { safeHttp } from '@inboxfm-connect/server-utils'
import { FastifyBaseLogger } from 'fastify'

// Connect proxy subdomain targeting. The request schema only validates `subdomain`
// in the request body; a subdomain resolved from a connection value reaches the
// service unvalidated. The service used to (a) skip validation entirely whenever a
// provider was registered without a `subdomainRegex` and (b) "verify" the final
// origin against an origin derived from the already-substituted base URL — a
// tautology that can never fail. A value like `evil.test#` substituted into
// `https://{subdomain}.provider.test` redirects the whole request — including the
// injected provider token — to an attacker host (`#` truncates the registered
// suffix at URL-parse time). These tests pin that the subdomain is validated
// BEFORE substitution and that the final hostname is pinned to the provider's
// registered suffix regardless of how permissive a provider regex is.

const mockRequest = vi.fn()

const mockDecryptAndRefreshConnection = vi.fn()

const mockFindOneBy = vi.fn()

vi.mock('../../../../src/app/app-connection/app-connection-service/app-connection-service', () => ({
    appConnectionsRepo: () => ({
        findOneBy: mockFindOneBy,
    }),
    appConnectionService: () => ({
        decryptAndRefreshConnection: mockDecryptAndRefreshConnection,
    }),
}))

const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
} as unknown as FastifyBaseLogger

async function importService() {
    const { connectProxyService, resolveProviderTargetUrl } = await import('../../../../src/app/connect-proxy/connect-proxy.service')
    return { connectProxyService: connectProxyService(log), resolveProviderTargetUrl }
}

// A provider registered with supportsSubdomain but WITHOUT a subdomainRegex — the
// exact shape a future registry entry could take (the registry's only subdomain
// provider today, zendesk, ships a regex; nothing enforces that for the next one).
const NO_REGEX_SUBDOMAIN_PROVIDER: SupportedProxyProvider = {
    provider: 'acme-saas',
    name: 'Acme SaaS',
    baseUrl: 'https://{subdomain}.acme-saas.test/api/v2',
    authType: 'bearer',
    supportsSubdomain: true,
}

// A provider whose regex is too permissive (allows dots) — the hostname pin must
// still keep the target inside the registered domain.
const PERMISSIVE_REGEX_PROVIDER: SupportedProxyProvider = {
    provider: 'permissive',
    name: 'Permissive',
    baseUrl: 'https://{subdomain}.provider.test/api',
    authType: 'bearer',
    supportsSubdomain: true,
    subdomainRegex: /^[a-z0-9.-]+$/,
}

const ZENDESK_LIKE_PROVIDER: SupportedProxyProvider = {
    provider: 'zendesk',
    name: 'Zendesk',
    baseUrl: 'https://{subdomain}.zendesk.com/api/v2',
    authType: 'bearer',
    supportsSubdomain: true,
    subdomainRegex: /^[a-zA-Z0-9-]+$/,
}

const PLAIN_PROVIDER: SupportedProxyProvider = {
    provider: 'slack',
    name: 'Slack',
    baseUrl: 'https://slack.com/api',
    authType: 'bearer',
}

function expectInvalidPathError(fn: () => unknown): void {
    try {
        fn()
        expect.unreachable('expected INVALID_PATH error')
    }
    catch (error) {
        expect((error as { error?: { params?: { code?: string } } }).error?.params?.code).toBe(ConnectProxyErrorCode.INVALID_PATH)
    }
}

describe('connect-proxy target URL resolution (pure)', () => {
    it('rejects a fragment-injected subdomain when the provider has no subdomainRegex', async () => {
        const { resolveProviderTargetUrl } = await importService()
        // Pre-fix behavior: substituted to https://evil.attacker.test#… — the origin
        // check compared that substituted origin to itself and passed.
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, 'evil.attacker.test#', 'tickets/1'))
    })

    it('rejects userinfo and authority-injection forms', async () => {
        const { resolveProviderTargetUrl } = await importService()
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, 'user@evil.attacker.test', 'tickets/1'))
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, 'evil.attacker.test:8443', 'tickets/1'))
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, 'evil.attacker.test/x', 'tickets/1'))
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, '%65vil.attacker.test', 'tickets/1'))
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, '\\evil.attacker.test', 'tickets/1'))
    })

    it('accepts a plain tenant label and resolves it under the provider host', async () => {
        const { resolveProviderTargetUrl } = await importService()
        const url = resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, 'mycompany', 'tickets/1')
        expect(url.toString()).toBe('https://mycompany.acme-saas.test/api/v2/tickets/1')
    })

    it('keeps zendesk-style providers working, including regex enforcement', async () => {
        const { resolveProviderTargetUrl } = await importService()
        const url = resolveProviderTargetUrl(ZENDESK_LIKE_PROVIDER, 'mycompany', '/tickets.json')
        expect(url.toString()).toBe('https://mycompany.zendesk.com/api/v2/tickets.json')
        expectInvalidPathError(() => resolveProviderTargetUrl(ZENDESK_LIKE_PROVIDER, 'invalid.domain/extra', '/tickets.json'))
    })

    it('pins the hostname to the registered suffix even when the provider regex is permissive', async () => {
        const { resolveProviderTargetUrl } = await importService()
        // Dots are allowed by this provider's regex, but the target must stay under
        // the provider's registered domain.
        const url = resolveProviderTargetUrl(PERMISSIVE_REGEX_PROVIDER, 'a.b', 'x')
        expect(url.hostname).toBe('a.b.provider.test')
        // A delimiter that slips past a sloppy future regex still cannot redirect
        // the host: the suffix pin is regex-independent.
        expectInvalidPathError(() => resolveProviderTargetUrl({
            ...PERMISSIVE_REGEX_PROVIDER,
            subdomainRegex: /.*/,
        }, 'evil#', 'x'))
    })

    it('rejects a missing subdomain for subdomain providers', async () => {
        const { resolveProviderTargetUrl } = await importService()
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, undefined, 'tickets/1'))
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, '', 'tickets/1'))
        expectInvalidPathError(() => resolveProviderTargetUrl(NO_REGEX_SUBDOMAIN_PROVIDER, null, 'tickets/1'))
    })

    it('keeps non-subdomain providers pinned to their registered origin', async () => {
        const { resolveProviderTargetUrl } = await importService()
        expect(resolveProviderTargetUrl(PLAIN_PROVIDER, undefined, '/chat.postMessage').toString()).toBe('https://slack.com/api/chat.postMessage')
        // Scheme-bearing paths must not drift the origin. (`//evil.test/x` is rejected
        // earlier by the service's path validation, and this function's leading-slash
        // normalization resolves any such input onto the same origin anyway.)
        expectInvalidPathError(() => resolveProviderTargetUrl(PLAIN_PROVIDER, undefined, 'https://evil.test/x'))
        expectInvalidPathError(() => resolveProviderTargetUrl(PLAIN_PROVIDER, undefined, 'mailto:evil@example.test'))
    })

    it('tolerates a misconfigured subdomain provider whose base URL has no placeholder', async () => {
        const { resolveProviderTargetUrl } = await importService()
        const url = resolveProviderTargetUrl({
            ...NO_REGEX_SUBDOMAIN_PROVIDER,
            baseUrl: 'https://api.acme-saas.test/api/v2',
        }, 'mycompany', 'tickets/1')
        expect(url.toString()).toBe('https://api.acme-saas.test/api/v2/tickets/1')
    })
})

describe('connect-proxy subdomain resolution through the service', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockRequest.mockResolvedValue({
            status: 200,
            statusText: 'OK',
            headers: {},
            data: {},
        })
        vi.spyOn(safeHttp, 'createAxios').mockReturnValue({ request: mockRequest } as never)
    })

    function seedZendeskConnection(subdomain: unknown) {
        const connection = {
            id: 'conn_zd',
            pieceName: 'zendesk',
            projectIds: ['proj_1'],
            externalId: 'cust_alice',
            status: 'ACTIVE',
            value: {
                access_token: 'zendesk_secret_token_123',
                subdomain,
            } as unknown as BaseOAuth2ConnectionValue,
        }
        mockFindOneBy.mockResolvedValue(connection)
        mockDecryptAndRefreshConnection.mockResolvedValue(connection)
        return connection
    }

    it('resolves a connection-stored subdomain to the provider host', async () => {
        const { connectProxyService } = await importService()
        seedZendeskConnection('mycompany')

        await connectProxyService.execute({
            projectId: 'proj_1',
            externalUserId: 'cust_alice',
            provider: 'zendesk',
            method: 'GET',
            path: '/tickets.json',
            timeoutMs: 5000,
        })

        expect(mockRequest.mock.calls[0][0].url).toBe('https://mycompany.zendesk.com/api/v2/tickets.json')
        expect(mockRequest.mock.calls[0][0].headers['Authorization']).toBe('Bearer zendesk_secret_token_123')
    })

    it('rejects a connection-stored subdomain containing URL delimiters', async () => {
        const { connectProxyService } = await importService()
        seedZendeskConnection('evil.attacker.test#')

        try {
            await connectProxyService.execute({
                projectId: 'proj_1',
                externalUserId: 'cust_alice',
                provider: 'zendesk',
                method: 'GET',
                path: '/tickets.json',
                timeoutMs: 5000,
            })
            expect.unreachable('execute should have rejected the subdomain')
        }
        catch (error) {
            expect((error as { error?: { params?: { code?: string } } }).error?.params?.code).toBe(ConnectProxyErrorCode.INVALID_PATH)
        }
        expect(mockRequest).not.toHaveBeenCalled()
    })
})
