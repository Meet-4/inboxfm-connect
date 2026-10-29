import { unique } from '@inboxfm-connect/core-utils'
import { AddAllowedEmbedOriginsRequestBody, AddAllowedEmbedOriginsResponse, EmbedSubdomain, GenerateEmbedSubdomainRequest, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI } from '@inboxfm-connect/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { platformService } from '../../platform/platform.service'
import { embedSubdomainService } from './embed-subdomain.service'

export const embedSubdomainController: FastifyPluginAsyncZod = async (app) => {
    app.post('/', UpsertSubdomainEndpoint, async (request) => {
        return embedSubdomainService(request.log).upsert({
            platformId: request.principal.platform.id,
            hostname: request.body.hostname,
        })
    })

    app.get('/', GetSubdomainEndpoint, async (request) => {
        return embedSubdomainService(request.log).checkAndUpdateStatus({
            platformId: request.principal.platform.id,
        })
    })

    app.post('/allowed-embed-origins', AddAllowedEmbedOriginsEndpoint, async (request) => {
        const platformId = request.principal.platform.id
        const platform = await platformService(request.log).getOneOrThrow(platformId)
        const merged = unique([...platform.allowedEmbedOrigins, ...request.body.allowedEmbedOrigins])
        const updated = await platformService(request.log).update({
            id: platformId,
            allowedEmbedOrigins: merged,
        })
        return { allowedEmbedOrigins: updated.allowedEmbedOrigins }
    })
}

const UpsertSubdomainEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        body: GenerateEmbedSubdomainRequest,
        response: {
            [StatusCodes.OK]: EmbedSubdomain,
        },
    },
}

const GetSubdomainEndpoint = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        response: {
            [StatusCodes.OK]: EmbedSubdomain.nullable(),
        },
    },
}

const AddAllowedEmbedOriginsEndpoint = {
    config: {
        // `allowedEmbedOrigins` is a platform-wide security control: it decides which
        // third-party pages may iframe this platform. Widening it is a platform-owner
        // action, so this is a platform-admin route — `publicPlatform([SERVICE])` let any
        // service credential through (including a Connect API key bound to a single
        // project, which must never reach platform scope) while rejecting the platform
        // owner herself. The platform-console backend's platform-wide `sk-` key still
        // passes; only project-bound credentials are turned away.
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['embedding'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        description: 'Add origins to the list allowed to embed this platform in an iframe. Existing origins are preserved; duplicates are ignored.',
        body: AddAllowedEmbedOriginsRequestBody,
        response: {
            [StatusCodes.OK]: AddAllowedEmbedOriginsResponse,
        },
    },
}
