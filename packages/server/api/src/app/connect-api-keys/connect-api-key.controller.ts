import { ApId, Permission, SeekPage } from '@inboxfm-connect/core-utils'
import { wideEvent } from '@inboxfm-connect/server-utils'
import {
    ConnectApiKeyResponseWithoutValue,
    ConnectApiKeyResponseWithValue,
    CreateConnectApiKeyRequest,
    PrincipalType,
} from '@inboxfm-connect/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType } from '../core/security/authorization/common'
import { securityAccess } from '../core/security/authorization/fastify-security'
import { auditEvents } from '../helper/audit-events'
import { ConnectApiKeyEntity } from './connect-api-key.entity'
import { connectApiKeyService } from './connect-api-key.service'

export const connectApiKeyController: FastifyPluginAsyncZod = async (app) => {
    app.post('/', CreateRequest, async (req, res) => {
        const newKey = await connectApiKeyService.add({
            platformId: req.principal.platform.id,
            projectId: req.body.projectId,
            displayName: req.body.displayName,
            expiresAt: req.body.expiresAt,
        })

        req.log.info({ apiKey: { id: newKey.id, action: 'created' } }, 'Connect API key created')
        wideEvent.audit(auditEvents.connectApiKeyCreated({
            actor: auditEvents.actorFromPrincipal(req.principal),
            target: { id: newKey.id, projectId: newKey.projectId, platformId: newKey.platformId },
        }))

        return res.status(StatusCodes.CREATED).send(newKey)
    })

    app.get('/', ListRequest, async (req) => {
        return connectApiKeyService.list({
            projectId: req.query.projectId,
            cursorRequest: req.query.cursor ?? null,
            limit: req.query.limit,
        })
    })

    app.post('/:id/rotate', RotateRequest, async (req, res) => {
        const rotatedKey = await connectApiKeyService.rotate({
            projectId: req.projectId,
            id: req.params.id,
        })

        req.log.info({ apiKey: { id: req.params.id, action: 'rotated' } }, 'Connect API key rotated')
        wideEvent.audit(auditEvents.connectApiKeyRotated({
            actor: auditEvents.actorFromPrincipal(req.principal),
            target: { id: req.params.id, projectId: req.projectId, replacementApiKeyId: rotatedKey.id },
        }))

        return res.status(StatusCodes.CREATED).send(rotatedKey)
    })

    app.delete('/:id', DeleteRequest, async (req, res) => {
        await connectApiKeyService.delete({
            projectId: req.projectId,
            id: req.params.id,
        })

        req.log.info({ apiKey: { id: req.params.id, action: 'revoked' } }, 'Connect API key revoked')
        wideEvent.audit(auditEvents.connectApiKeyRevoked({
            actor: auditEvents.actorFromPrincipal(req.principal),
            target: { id: req.params.id, projectId: req.projectId },
        }))

        return res.status(StatusCodes.OK).send()
    })
}

const CreateRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.WRITE_API_KEY,
            { type: ProjectResourceType.BODY },
        ),
    },
    schema: {
        tags: ['connect-api-keys'],
        description: 'Create an API key scoped to a single project, used to authenticate the Connect API (connect sessions, execute)',
        body: CreateConnectApiKeyRequest,
        response: {
            [StatusCodes.CREATED]: ConnectApiKeyResponseWithValue,
        },
    },
}

const ListRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.READ_API_KEY,
            { type: ProjectResourceType.QUERY },
        ),
    },
    schema: {
        tags: ['connect-api-keys'],
        querystring: z.object({
            projectId: ApId,
            cursor: z.string().optional(),
            limit: z.string().optional(),
        }),
        response: {
            // `next`/`previous` were declared `z.null()` when the list was an
            // unbounded dump; real cursor pagination emits opaque cursor
            // strings when more rows exist (still null on the last page).
            [StatusCodes.OK]: SeekPage(ConnectApiKeyResponseWithoutValue),
        },
    },
}

const DeleteRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.WRITE_API_KEY,
            { type: ProjectResourceType.TABLE, tableName: ConnectApiKeyEntity },
        ),
    },
    schema: {
        tags: ['connect-api-keys'],
        params: z.object({
            id: ApId,
        }),
    },
}

const RotateRequest = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER],
            Permission.WRITE_API_KEY,
            { type: ProjectResourceType.TABLE, tableName: ConnectApiKeyEntity },
        ),
    },
    schema: {
        tags: ['connect-api-keys'],
        description: 'Create a replacement Connect API key and expire the current one after a grace period, instead of an immediate hard cutover',
        params: z.object({
            id: ApId,
        }),
        response: {
            [StatusCodes.CREATED]: ConnectApiKeyResponseWithValue,
        },
    },
}
