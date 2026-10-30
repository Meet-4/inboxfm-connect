import { ActivepiecesError, deleteProps, ErrorCode, isNil } from '@inboxfm-connect/core-utils'
import { PropertyType } from '@inboxfm-connect/pieces-framework'
import { AppConnectionType, PlatformOAuth2ConnectionValue } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import {
    ClaimOAuth2Request,
    RefreshOAuth2Request,
} from '../../app-connection/app-connection-service/oauth2/oauth2-service'
import { credentialsOauth2Service } from '../../app-connection/app-connection-service/oauth2/services/credentials-oauth2-service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { oauthAppService } from '../oauth-apps/oauth-app.service'

export const platformOAuth2Service = (log: FastifyBaseLogger) => ({
    claim: async ({
        request,
        pieceName,
        platformId,
        projectId,
    }: ClaimOAuth2Request): Promise<PlatformOAuth2ConnectionValue> => {
        const { auth } = await pieceMetadataService(log).getOrThrow({
            name: pieceName,
            version: undefined,
            platformId,
        })
        if (isNil(auth)) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Auth is required to claim a platform oauth2 connection piece ${pieceName},platformId: ${platformId},projectId: ${projectId}`,
                },
            })
        }
        const oauth2Auth = Array.isArray(auth) ? auth.find(auth => auth.type === PropertyType.OAUTH2) : auth
        if (isNil(oauth2Auth) || oauth2Auth.type !== PropertyType.OAUTH2) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Cannot claim auth for non oauth2 property ${oauth2Auth?.type} ${pieceName}`,
                },
            })
        }
        const oauth2App = await oauthAppService.getWithSecret({
            pieceName,
            clientId: request.clientId,
            platformId,
        })

        const claimedValue = await credentialsOauth2Service(log).claim({
            request: {
                ...request,
                clientId: oauth2App.clientId,
                clientSecret: oauth2App.clientSecret,
            },
            projectId,
            platformId,
            pieceName,
        })
        // The platform app's client secret must not be persisted into the
        // project-scoped connection row. The claim response otherwise carries
        // it into appConnectionService.upsert's stored value (the request DTO
        // for platform connections has no client_secret field, so nothing
        // overrides it), copying the platform-wide secret into every project
        // row claimed with it. Refresh never reads the stored secret — it
        // re-fetches it from oauth-apps on every refresh — so strip it at the
        // boundary here. deleteProps returns a NEW object (it does not
        // mutate), so its result must be used.
        const claimedValueWithoutSecret = deleteProps(claimedValue, ['client_secret'])
        return {
            ...claimedValueWithoutSecret,
            type: AppConnectionType.PLATFORM_OAUTH2,
        }
    },
    refresh: async ({
        pieceName,
        projectId,
        platformId,
        connectionValue,
    }: RefreshOAuth2Request<PlatformOAuth2ConnectionValue>): Promise<PlatformOAuth2ConnectionValue> => {
        const oauth2App = await oauthAppService.getWithSecret({
            pieceName,
            clientId: connectionValue.client_id,
            platformId,
        })
        const newValue = await credentialsOauth2Service(log).refresh({
            pieceName,
            projectId,
            platformId,
            connectionValue: {
                ...connectionValue,
                type: AppConnectionType.OAUTH2,
                client_secret: oauth2App.clientSecret,
            },
        })
        return {
            expires_in: newValue.expires_in,
            client_id: newValue.client_id,
            token_type: newValue.token_type,
            access_token: newValue.access_token,
            claimed_at: newValue.claimed_at,
            refresh_token: newValue.refresh_token,
            redirect_url: newValue.redirect_url,
            scope: newValue.scope,
            token_url: newValue.token_url,
            data: newValue.data,
            props: newValue.props,
            authorization_method: newValue.authorization_method,
            type: AppConnectionType.PLATFORM_OAUTH2,
        }
    },
})
