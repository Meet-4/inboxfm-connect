import { ApId, assertNotNullOrUndefined, SeekPage } from '@inboxfm-connect/core-utils'
import { wideEvent } from '@inboxfm-connect/server-utils'
import { ApiKeyResponseWithoutValue, ApiKeyResponseWithValue, CreateApiKeyRequest, PrincipalType } from '@inboxfm-connect/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { auditEvents } from '../../helper/audit-events'
import { platformMustHaveFeatureEnabled } from '../authentication/ee-authorization'
import { apiKeyService } from './api-key-service'

export const apiKeyModule: FastifyPluginAsyncZod = async (app) => {
    app.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.apiKeysEnabled))
    await app.register(apiKeyController, { prefix: '/v1/api-keys' })
}

export const apiKeyController: FastifyPluginAsyncZod = async (app) => {
    app.post('/', CreateRequest, async (req, res) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')

        const newApiKey = await apiKeyService.add({
            platformId,
            displayName: req.body.displayName,
            expiresAt: req.body.expiresAt,
        })

        req.log.info({ apiKey: { id: newApiKey.id, action: 'created' } }, 'Platform API key created')
        wideEvent.audit(auditEvents.apiKeyCreated({
            actor: auditEvents.actorFromPrincipal(req.principal),
            target: { id: newApiKey.id, platformId },
        }))

        return res.status(StatusCodes.CREATED).send(newApiKey)
    })

    app.get('/', ListRequest, async (req) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')
        return apiKeyService.list({
            platformId,
            cursorRequest: req.query.cursor ?? null,
            limit: req.query.limit,
        })
    })

    app.post('/:id/rotate', RotateRequest, async (req, res) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')
        const rotatedApiKey = await apiKeyService.rotate({
            id: req.params.id,
            platformId,
        })

        req.log.info({ apiKey: { id: req.params.id, action: 'rotated' } }, 'Platform API key rotated')
        wideEvent.audit(auditEvents.apiKeyRotated({
            actor: auditEvents.actorFromPrincipal(req.principal),
            target: { id: req.params.id, platformId, replacementApiKeyId: rotatedApiKey.id },
        }))

        return res.status(StatusCodes.CREATED).send(rotatedApiKey)
    })

    app.delete('/:id', DeleteRequest, async (req, res) => {
        const platformId = req.principal.platform.id
        assertNotNullOrUndefined(platformId, 'platformId')
        await apiKeyService.delete({
            id: req.params.id,
            platformId,
        })

        req.log.info({ apiKey: { id: req.params.id, action: 'revoked' } }, 'Platform API key revoked')
        wideEvent.audit(auditEvents.apiKeyRevoked({
            actor: auditEvents.actorFromPrincipal(req.principal),
            target: { id: req.params.id, platformId },
        }))

        return res.status(StatusCodes.OK).send()
    })
}

const ListRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        querystring: z.object({
            cursor: z.string().optional(),
            limit: z.string().optional(),
        }),
        response: {
            [StatusCodes.OK]: SeekPage(ApiKeyResponseWithoutValue),
        },
    },
}

const CreateRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        body: CreateApiKeyRequest,
        response: {
            [StatusCodes.CREATED]: ApiKeyResponseWithValue,
        },
    },
}

const DeleteRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        params: z.object({
            id: ApId,
        }),
    },
}

const RotateRequest = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER]),
    },
    schema: {
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.CREATED]: ApiKeyResponseWithValue,
        },
    },
}
