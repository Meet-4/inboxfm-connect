import { ActivepiecesError, ErrorCode, isNil, SeekPage } from '@inboxfm-connect/core-utils'
import { ListPlatformAppConnectionsRequestQuery, PlatformAppConnectionOwnersResponse, PlatformAppConnectionsListItem, Principal, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI } from '@inboxfm-connect/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { appConnectionService } from './app-connection-service/app-connection-service'

/**
 * Project-scoped Connect API keys (`cak-`) authenticate as SERVICE principals
 * carrying the single project they were minted for (`principal.projectId`); a
 * platform-wide API key (`sk-`) is a SERVICE principal with no project binding.
 *
 * PLATFORM admin authorization short-circuits for SERVICE principals, and the
 * generic project-scoped-key guard for platform-wide routes deliberately
 * exempts `adminOnly` routes — so nothing else keeps a project member with
 * WRITE_API_KEY from minting a `cak-` and reaching the platform-admin
 * connection surface: every connection across the platform and its owners'
 * PII, plus create/update/delete of platform-shared (global) connections.
 * The connection routes enforce that boundary themselves.
 */
export function assertPrincipalCanAccessPlatformConnections(principal: Principal): void {
    if (principal.type === PrincipalType.SERVICE && !isNil(principal.projectId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'This API key is scoped to a single project and cannot access platform-wide connections',
            },
        })
    }
}

export const platformAppConnectionController: FastifyPluginAsyncZod = async (app) => {
    app.get('/', ListPlatformAppConnectionsRequest, async (request): Promise<SeekPage<PlatformAppConnectionsListItem>> => {
        assertPrincipalCanAccessPlatformConnections(request.principal)
        const { displayName, pieceName, status, scope, cursor, limit, projectIds, ownerIds } = request.query
        return appConnectionService(request.log).listForPlatform({
            platformId: request.principal.platform.id,
            pieceName,
            displayName,
            status,
            scope,
            projectIds,
            ownerIds,
            cursorRequest: cursor ?? null,
            limit: limit ?? DEFAULT_PAGE_SIZE,
        })
    })

    app.get('/owners', ListPlatformAppConnectionOwnersRequest, async (request): Promise<PlatformAppConnectionOwnersResponse> => {
        assertPrincipalCanAccessPlatformConnections(request.principal)
        return appConnectionService(request.log).listOwnersForPlatform({
            platformId: request.principal.platform.id,
        })
    })
}

const DEFAULT_PAGE_SIZE = 10

const ListPlatformAppConnectionsRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        querystring: ListPlatformAppConnectionsRequestQuery,
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: SeekPage(PlatformAppConnectionsListItem),
        },
    },
}

const ListPlatformAppConnectionOwnersRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        response: {
            [StatusCodes.OK]: PlatformAppConnectionOwnersResponse,
        },
    },
}
