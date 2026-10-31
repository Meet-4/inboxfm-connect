import { z } from 'zod'
import { AppConnectionScope, AppConnectionType } from '../app-connection'
import { OAuth2AuthorizationMethod } from '../oauth2-authorization-method'

// Connection externalIds are embedded verbatim inside `{{connections['…']}}`
// template refs — flow/agent step auth, project-replace snapshots, and the
// engine's props resolver all parse that grammar (quotes and brackets are its
// delimiters). An externalId containing those characters produces refs that
// cannot be resolved (or injects arbitrary template content when re-exported),
// and control characters corrupt logs and UI rendering. The length cap bounds
// the encrypted row, the Redis upsert-lock key and snapshot artifacts.
const EXTERNAL_ID_MAX_LENGTH = 128
const DISPLAY_NAME_MAX_LENGTH = 512
const METADATA_MAX_KEYS = 50
const METADATA_MAX_KEY_LENGTH = 128
const METADATA_MAX_SERIALIZED_LENGTH = 64 * 1024

export const ExternalIdSchema = z.string()
    .min(1, 'externalId must not be empty')
    .max(EXTERNAL_ID_MAX_LENGTH)
    .regex(
        /^[^'"\\\[\]{}\x00-\x1f\x7f]*$/,
        'externalId must not contain quotes, brackets, braces, backslashes or control characters',
    )

// Display names are rendered in the UI and written to logs/audit events —
// cap the length and reject control characters (tab/newline/CR excepted).
export const DisplayNameSchema = z.string()
    .min(1)
    .max(DISPLAY_NAME_MAX_LENGTH)
    .refine((value) => {
        for (const ch of value) {
            const code = ch.codePointAt(0) ?? 0
            if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false
            if (code === 0x7f) return false
        }
        return true
    }, 'displayName must not contain control characters')

// Metadata is a free-form record stored as a jsonb column on every connection
// row; without caps a single request can store an unbounded payload.
// (Built on the local full-zod record rather than core-utils' zod/mini
// `Metadata` — the mini API has no instance `.refine`.)
export const ConnectionMetadataSchema = z.record(z.string(), z.unknown()).refine((metadata) => {
    const keys = Object.keys(metadata)
    if (keys.length > METADATA_MAX_KEYS) return false
    if (keys.some((key) => key.length > METADATA_MAX_KEY_LENGTH)) return false
    return JSON.stringify(metadata).length <= METADATA_MAX_SERIALIZED_LENGTH
}, 'connection metadata exceeds size limits (at most 50 keys, 128-char keys, 64KiB total)')

const commonAuthProps = {
    externalId: ExternalIdSchema,
    displayName: DisplayNameSchema,
    pieceName: z.string(),
    projectId: z.string(),
    metadata: z.optional(ConnectionMetadataSchema),
    pieceVersion: z.string().optional(),
}


export const BOTH_CLIENT_CREDENTIALS_AND_AUTHORIZATION_CODE = 'both_client_credentials_and_authorization_code'

export const PLACEHOLDER_CONNECTION_TYPE = 'PLACEHOLDER'

export enum OAuth2GrantType {
    AUTHORIZATION_CODE = 'authorization_code',
    CLIENT_CREDENTIALS = 'client_credentials',
}

const propsSchema = z.record(z.string(), z.unknown())
export const UpsertCustomAuthRequest = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.CUSTOM_AUTH),
    value: z.object({
        type: z.literal(AppConnectionType.CUSTOM_AUTH),
        props: propsSchema,
    }),
}).describe('Custom Auth')

export const UpsertOIDCRequest = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.OIDC),
    value: z.object({
        type: z.literal(AppConnectionType.OIDC),
        props: propsSchema,
    }),
}).describe('OIDC')

export const UpsertNoAuthRequest = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.NO_AUTH),
    value: z.object({
        type: z.literal(AppConnectionType.NO_AUTH),
    }),
}).describe('No Auth')

export const UpsertPlaceholderConnectionRequest = z.object({
    ...commonAuthProps,
    type: z.literal(PLACEHOLDER_CONNECTION_TYPE),
}).describe('Placeholder')

const commonOAuth2ValueProps = {
    client_id: z.string().min(1),
    code: z.string().min(1),
    code_challenge: z.string().optional(),
    scope: z.string(),
    authorization_method: z.nativeEnum(OAuth2AuthorizationMethod).optional(),
}
export const UpsertPlatformOAuth2Request = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.PLATFORM_OAUTH2),
    value: z.object({
        ...commonOAuth2ValueProps,
        props: propsSchema.optional(),
        type: z.literal(AppConnectionType.PLATFORM_OAUTH2),
        redirect_url: z.string().min(1),
    }),
}).describe('Platform OAuth2')


export const UpsertCloudOAuth2Request = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.CLOUD_OAUTH2),
    value: z.object({
        ...commonOAuth2ValueProps,
        props: propsSchema.optional(),
        scope: z.string(),
        type: z.literal(AppConnectionType.CLOUD_OAUTH2),
    }),
}).describe('Cloud OAuth2')

export const UpsertSecretTextRequest = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.SECRET_TEXT),
    value: z.object({
        type: z.literal(AppConnectionType.SECRET_TEXT),
        secret_text: z.string().min(1),
    }),
}).describe('Secret Text')

export const UpsertOAuth2Request = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.OAUTH2),
    value: z.object({
        ...commonOAuth2ValueProps,
        client_secret: z.string().min(1),
        grant_type: z.nativeEnum(OAuth2GrantType).optional(),
        props: z.record(z.string(), z.any()).optional(),
        authorization_method: z.nativeEnum(OAuth2AuthorizationMethod).optional(),
        redirect_url: z.string().min(1),
        type: z.literal(AppConnectionType.OAUTH2),
    }),
}).describe('OAuth2')

export const UpsertBasicAuthRequest = z.object({
    ...commonAuthProps,
    type: z.literal(AppConnectionType.BASIC_AUTH),
    value: z.object({
        username: z.string().min(1),
        password: z.string().min(1),
        type: z.literal(AppConnectionType.BASIC_AUTH),
    }),
}).describe('Basic Auth')

export const UpsertAppConnectionRequestBody = z.union([
    UpsertSecretTextRequest,
    UpsertOAuth2Request,
    UpsertCloudOAuth2Request,
    UpsertPlatformOAuth2Request,
    UpsertBasicAuthRequest,
    UpsertCustomAuthRequest,
    UpsertOIDCRequest,
    UpsertNoAuthRequest,
    UpsertPlaceholderConnectionRequest,
])

export type UpsertCloudOAuth2Request = z.infer<typeof UpsertCloudOAuth2Request>
export type UpsertPlatformOAuth2Request = z.infer<typeof UpsertPlatformOAuth2Request>
export type UpsertOAuth2Request = z.infer<typeof UpsertOAuth2Request>
export type UpsertSecretTextRequest = z.infer<typeof UpsertSecretTextRequest>
export type UpsertBasicAuthRequest = z.infer<typeof UpsertBasicAuthRequest>
export type UpsertCustomAuthRequest = z.infer<typeof UpsertCustomAuthRequest>
export type UpsertOIDCRequest = z.infer<typeof UpsertOIDCRequest>
export type UpsertNoAuthRequest = z.infer<typeof UpsertNoAuthRequest>
export type UpsertPlaceholderConnectionRequest = z.infer<typeof UpsertPlaceholderConnectionRequest>
export type UpsertAppConnectionRequestBody = z.infer<typeof UpsertAppConnectionRequestBody>


export const UpdateConnectionValueRequestBody = z.object({
    displayName: DisplayNameSchema,
    metadata: z.optional(ConnectionMetadataSchema),
})

export const UpdateGlobalConnectionValueRequestBody = z.object({
    displayName: DisplayNameSchema,
    projectIds: z.array(z.string()).optional(),
    metadata: z.optional(ConnectionMetadataSchema),
    preSelectForNewProjects: z.boolean().optional(),
})

export type UpdateConnectionValueRequestBody = z.infer<typeof UpdateConnectionValueRequestBody>
export type UpdateGlobalConnectionValueRequestBody = z.infer<typeof UpdateGlobalConnectionValueRequestBody>
const GlobalConnectionExtras = z.object({
    scope: z.literal(AppConnectionScope.PLATFORM),
    projectIds: z.array(z.string()),
    externalId: ExternalIdSchema.optional(),
    metadata: z.optional(ConnectionMetadataSchema),
    preSelectForNewProjects: z.boolean().optional(),
})
export const UpsertGlobalConnectionRequestBody =
    z.union([
        UpsertSecretTextRequest.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertOAuth2Request.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertCloudOAuth2Request.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertPlatformOAuth2Request.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertBasicAuthRequest.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertCustomAuthRequest.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertOIDCRequest.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
        UpsertNoAuthRequest.omit({ projectId: true, externalId: true }).merge(GlobalConnectionExtras),
    ])
export type UpsertGlobalConnectionRequestBody = z.infer<typeof UpsertGlobalConnectionRequestBody>

export const GetOAuth2AuthorizationUrlRequestBody = z.object({
    pieceName: z.string(),
    pieceVersion: z.string().optional(),
    projectId: z.string().optional(),
    clientId: z.string(),
    redirectUrl: z.string(),
    scopes: z.array(z.string()).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
})
export type GetOAuth2AuthorizationUrlRequestBody = z.infer<typeof GetOAuth2AuthorizationUrlRequestBody>

export const GetOAuth2AuthorizationUrlResponse = z.object({
    authorizationUrl: z.string(),
    codeVerifier: z.string().optional(),
})
export type GetOAuth2AuthorizationUrlResponse = z.infer<typeof GetOAuth2AuthorizationUrlResponse>

export const ReplaceAppConnectionsRequestBody = z.object({
    sourceAppConnectionId: z.string(),
    targetAppConnectionId: z.string(),
    projectId: z.string(),
    deleteSourceConnection: z.boolean().optional().default(false),
    applyToPublishedVersions: z.boolean().optional().default(false),
})
export type ReplaceAppConnectionsRequestBody = z.infer<typeof ReplaceAppConnectionsRequestBody>

export const ListFlowsFromAppConnectionRequestQuery = z.object({
    sourceAppConnectionIds: z.array(z.string()),
    projectId: z.string(),
})
export type ListFlowsFromAppConnectionRequestQuery = z.infer<typeof ListFlowsFromAppConnectionRequestQuery>

