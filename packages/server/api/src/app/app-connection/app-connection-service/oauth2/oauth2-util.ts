import { createHash, randomBytes } from 'crypto'
import { ActivepiecesError, assertNotNullOrUndefined, deleteProps, ErrorCode, PlatformId } from '@inboxfm-connect/core-utils'
import { PropertyType } from '@inboxfm-connect/pieces-framework'
import { AppConnection, AppConnectionType, BaseOAuth2ConnectionValue, GetOAuth2AuthorizationUrlResponse, OAuth2GrantType, resolveValueFromProps } from '@inboxfm-connect/shared'
import { isAxiosError } from 'axios'
import { FastifyBaseLogger } from 'fastify'
import { nanoid } from 'nanoid'
import { secretManagersService } from '../../../ee/secret-managers/secret-managers.service'
import { pieceMetadataService } from '../../../pieces/metadata/piece-metadata-service'

export const oauth2Util = (log: FastifyBaseLogger) => ({
    formatOAuth2Response: (response: Omit<BaseOAuth2ConnectionValue, 'claimed_at'>): BaseOAuth2ConnectionValue => {
        const secondsSinceEpoch = Math.round(Date.now() / 1000)
        const formattedResponse: BaseOAuth2ConnectionValue = {
            ...response,
            // `data` echoes the provider response so pieces can read non-token
            // extras (e.g. Zoho's api_domain), but it must not duplicate the
            // token fields. deleteProps returns a NEW object — it does not
            // mutate — so the previous call was a silent no-op and stored the
            // full provider response, secrets included, in every connection
            // value.
            data: deleteProps(response, [
                'access_token',
                'expires_in',
                'refresh_token',
                'scope',
                'token_type',
            ]),
            claimed_at: secondsSinceEpoch,
        }
        return formattedResponse
    },
    isExpired: (connection: BaseOAuth2ConnectionValue): boolean => {
        const secondsSinceEpoch = Math.round(Date.now() / 1000)
        const grantType = connection.grant_type ?? OAuth2GrantType.AUTHORIZATION_CODE
        if (
            grantType === OAuth2GrantType.AUTHORIZATION_CODE &&
            !connection.refresh_token
        ) {
            return false
        }
        const expiresIn = connection.expires_in ?? 60 * 60
        const refreshThreshold = 15 * 60
        return (
            secondsSinceEpoch + refreshThreshold >= connection.claimed_at + expiresIn
        )
    },
    isUserError: (e: unknown): boolean => {
        if (isAxiosError(e)) {
            const error = e.response?.data.error
            switch (error) {
                case 'invalid_grant':
                    return true
                case 'invalid_request':
                case 'invalid_client':
                case 'invalid_scope':
                case 'unauthorized_client':
                case 'unsupported_grant_type':
                default:
                    return false
            }
        }
        return false
    },
    getOAuth2TokenUrl: async ({
        platformId,
        pieceName,
        pieceVersion,
        props,
    }: OAuth2TokenUrlParams): Promise<string> => {
        const pieceMetadata = await pieceMetadataService(log).getOrThrow({
            name: pieceName,
            platformId,
            version: pieceVersion,
        })
        const pieceAuth = Array.isArray(pieceMetadata.auth) ? pieceMetadata.auth.find(auth => auth.type === PropertyType.OAUTH2) : pieceMetadata.auth
        assertNotNullOrUndefined(pieceAuth, 'auth')
        switch (pieceAuth.type) {
            case PropertyType.OAUTH2:
                return resolveValueFromProps(props, pieceAuth.tokenUrl)
            default:
                throw new ActivepiecesError({
                    code: ErrorCode.INVALID_APP_CONNECTION,
                    params: {
                        error: 'invalid auth type',
                    },
                })
        }
    },
    buildAuthorizationUrl: async ({
        platformId,
        pieceName,
        pieceVersion,
        clientId,
        redirectUrl,
        projectId,
        props,
        scopes,
    }: BuildAuthorizationUrlParams): Promise<GetOAuth2AuthorizationUrlResponse> => {
        const pieceMetadata = await pieceMetadataService(log).getOrThrow({
            name: pieceName,
            platformId,
            version: pieceVersion,
        })
        const pieceAuth = Array.isArray(pieceMetadata.auth)
            ? pieceMetadata.auth.find(auth => auth.type === PropertyType.OAUTH2)
            : pieceMetadata.auth
        assertNotNullOrUndefined(pieceAuth, 'auth')
        if (pieceAuth.type !== PropertyType.OAUTH2) {
            throw new ActivepiecesError({
                code: ErrorCode.INVALID_APP_CONNECTION,
                params: { error: 'invalid auth type' },
            })
        }

        const resolvedClientId = await secretManagersService(log).resolveString({
            key: clientId,
            platformId,
            throwOnFailure: true,
            projectIds: projectId ? [projectId] : undefined,
        })
        const authUrl = resolveValueFromProps(props, pieceAuth.authUrl)
        const selectedScopes = resolveSelectedScopes(scopes, pieceAuth.scope)
        const scope = resolveValueFromProps(props, selectedScopes.join(' '))

        const queryParams: Record<string, string> = {
            response_type: 'code',
            client_id: resolvedClientId,
            redirect_uri: redirectUrl,
            access_type: 'offline',
            state: nanoid(),
            prompt: 'consent',
            scope,
            ...(pieceAuth.extra ?? {}),
        }

        const prompt = pieceAuth.prompt
        if (prompt === 'omit') {
            delete queryParams['prompt']
        }
        else if (prompt !== undefined && prompt !== null) {
            queryParams['prompt'] = prompt
        }

        let codeVerifier: string | undefined
        if (pieceAuth.pkce) {
            codeVerifier = randomBytes(32).toString('base64url').slice(0, 43)
            const method = pieceAuth.pkceMethod ?? 'plain'
            queryParams['code_challenge_method'] = method
            if (method === 'S256') {
                const hash = createHash('sha256').update(codeVerifier).digest()
                queryParams['code_challenge'] = Buffer.from(hash).toString('base64url')
            }
            else {
                queryParams['code_challenge'] = codeVerifier
            }
        }

        const url = new URL(authUrl)
        Object.entries(queryParams).forEach(([key, value]) => {
            if (value !== '') {
                url.searchParams.append(key, value)
            }
        })

        return {
            authorizationUrl: url.toString(),
            codeVerifier,
        }
    },
    removeRefreshTokenAndClientSecret: (connection: AppConnection): AppConnection => {
        if (connection.value.type === AppConnectionType.OAUTH2
            || connection.value.type === AppConnectionType.CLOUD_OAUTH2
            || connection.value.type === AppConnectionType.PLATFORM_OAUTH2) {
            connection.value = {
                ...connection.value,
                refresh_token: '(REDACTED)',
            }
            // The client secret is only needed by the server-side refresh (which
            // re-resolves it from the stored value / secret manager); the engine
            // boundary only needs the access_token to run steps. Redact it for
            // every OAuth2 family type that carries one — previously only
            // OAUTH2 + CLIENT_CREDENTIALS was redacted, so authorization-code
            // connections handed their client secret (secret-manager-resolved
            // to the live value by the worker controller) to the engine, and
            // legacy platform rows did the same with the platform app secret.
            const value = connection.value as unknown as Record<string, unknown>
            if ('client_secret' in value) {
                value['client_secret'] = '(REDACTED)'
            }
            // Rows written while formatOAuth2Response's data echo was a silent
            // no-op still duplicate the provider's token response inside
            // `data` — strip the same known token fields there (piece-facing
            // extras like Zoho's api_domain are kept), so the engine boundary
            // stops leaking refresh tokens through the echo.
            if (typeof value['data'] === 'object' && value['data'] !== null) {
                value['data'] = deleteProps(value['data'] as Record<string, unknown>, [
                    'access_token',
                    'expires_in',
                    'refresh_token',
                    'scope',
                    'token_type',
                ])
            }
        }
        return connection
    },
})

type OAuth2TokenUrlParams = {
    platformId: PlatformId
    pieceName: string
    pieceVersion?: string
    props?: Record<string, unknown>
}

const resolveSelectedScopes = (requested: string[] | undefined, allowed: string[]): string[] => {
    if (requested === undefined) {
        return allowed
    }
    const allowedSet = new Set(allowed)
    const invalid = requested.filter(scope => !allowedSet.has(scope))
    if (invalid.length > 0) {
        throw new ActivepiecesError({
            code: ErrorCode.INVALID_APP_CONNECTION,
            params: { error: `requested scopes are not declared by the piece: ${invalid.join(', ')}` },
        })
    }
    if (requested.length === 0) {
        throw new ActivepiecesError({
            code: ErrorCode.INVALID_APP_CONNECTION,
            params: { error: 'at least one scope must be selected' },
        })
    }
    return requested
}

type BuildAuthorizationUrlParams = {
    platformId: PlatformId
    pieceName: string
    pieceVersion?: string
    clientId: string
    redirectUrl: string
    props?: Record<string, unknown>
    projectId?: string
    scopes?: string[]
}
