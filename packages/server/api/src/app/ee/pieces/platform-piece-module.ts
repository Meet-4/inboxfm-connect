import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'
import { AddPieceRequestBody, PieceScope, PrincipalType, SERVICE_KEY_SECURITY_OPENAPI } from '@inboxfm-connect/shared'
import { FastifyPluginAsyncZod, FastifyPluginCallbackZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { platformMustHaveFeatureEnabled } from '../authentication/ee-authorization'
import { pieceInstallService } from '../../pieces/piece-install-service'

export const platformPieceModule: FastifyPluginAsyncZod = async (app) => {
    // Platform-scope piece installation is the `managePiecesEnabled` plan
    // entitlement (set from license keys via applyLimits). Without this
    // preHandler a cloud-standard or unlicensed EE platform can install
    // platform pieces for free. The CE edition is unaffected: it registers
    // communityPiecesModule instead, which is intentionally ungated.
    app.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.managePiecesEnabled))
    await app.register(platformPieceController, { prefix: '/v1/integrations' })
}

const platformPieceController: FastifyPluginCallbackZod = (
    app,
    _opts,
    done,
) => {

    app.post('/', installPieceParams, async (req, reply) => {
        const platformId = req.principal.platform.id
        assertOneOfTheseScope(req.body.scope, [PieceScope.PLATFORM])
        await pieceInstallService(req.log).installPiece(
            platformId,
            req.body,
        )
        await reply.status(StatusCodes.CREATED).send({})
    },
    )
    done()
}


const installPieceParams = {
    config: {
        security: securityAccess.platformAdminOnly([PrincipalType.USER, PrincipalType.SERVICE]),
    },
    schema: {
        tags: ['pieces'],
        security: [SERVICE_KEY_SECURITY_OPENAPI],
        summary: 'Add a piece to a platform',
        description: 'Add a piece to a platform',
        body: AddPieceRequestBody,
        response: {
            [StatusCodes.CREATED]: z.object({}),
        },
    },
}

function assertOneOfTheseScope(
    scope: PieceScope,
    allowedScopes: PieceScope[],
): void {
    if (!allowedScopes.includes(scope)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Only project scope is allowed for cloud platform',
            },
        })
    }
}
