import { isNil, tryCatch } from '@inboxfm-connect/core-utils'
import { HeadlessRuntime } from '@inboxfm-connect/runtime'
import { apLogger } from '@inboxfm-connect/server-utils'
import { AppConnectionStatus, McpToolResult, NetworkMode } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { ArrayContains } from 'typeorm'
import { accessTokenManager } from '../../authentication/lib/access-token-manager'
import { appConnectionService, appConnectionsRepo } from '../../app-connection/app-connection-service/app-connection-service'
import { AppConnectionSchema } from '../../app-connection/app-connection.entity'
import { domainHelper } from '../../helper/domain-helper'
import { system } from '../../helper/system/system'
import { AppSystemProp } from '../../helper/system/system-props'
import { projectService } from '../../project/project-service'
import { pieceMetadataService } from '../../pieces/metadata/piece-metadata-service'
import { mcpUtils } from './mcp-utils'

const runtimeLog = apLogger.create({ bindings: {} })

const runtime = new HeadlessRuntime<AppConnectionSchema>({
    basePath: process.cwd(),
    log: runtimeLog,
    getSettings: () => ({
        EXECUTION_MODE: system.get(AppSystemProp.EXECUTION_MODE) ?? 'UNSANDBOXED',
        SANDBOX_MEMORY_LIMIT: system.get(AppSystemProp.SANDBOX_MEMORY_LIMIT) ?? '1048576',
        FLOW_TIMEOUT_SECONDS: Number(system.get(AppSystemProp.FLOW_TIMEOUT_SECONDS) ?? '60'),
        MAX_FLOW_RUN_LOG_SIZE_MB: Number(system.get(AppSystemProp.MAX_FLOW_RUN_LOG_SIZE_MB) ?? '1'),
        MAX_FILE_SIZE_MB: Number(system.get(AppSystemProp.MAX_FILE_SIZE_MB) ?? '10'),
        NETWORK_MODE: system.get(AppSystemProp.NETWORK_MODE) === NetworkMode.UNRESTRICTED ? NetworkMode.UNRESTRICTED : NetworkMode.STRICT,
        DEV_PIECES: (system.get(AppSystemProp.DEV_PIECES) ?? '').split(',').map(value => value.trim()).filter(Boolean),
        ENVIRONMENT: system.get(AppSystemProp.ENVIRONMENT) ?? '',
        REUSE_SANDBOX: undefined,
        SANDBOX_PROPAGATED_ENV_VARS: [],
        SSRF_ALLOW_LIST: (system.get(AppSystemProp.SSRF_ALLOW_LIST) ?? '').split(',').map(value => value.trim()).filter(Boolean),
        WORKER_GROUP_ID: 'headless',
        PROJECT_WORKER: false,
    }),
    database: {
        async getConnection({ connectionId }) {
            const connection = await appConnectionsRepo().findOneBy({ id: connectionId })
            return connection ?? null
        },
        async saveConnection({ connection }) {
            await appConnectionsRepo().save(connection)
        },
        async deleteConnection({ connectionId }) {
            await appConnectionsRepo().delete({ id: connectionId })
        },
    },
    decryptAndRefresh: async ({ connection }) => {
        const projectId = connection.projectIds?.[0]
        if (!projectId) {
            throw new Error(`Connection has no projectIds: ${connection.id}`)
        }
        return appConnectionService(runtimeLog).decryptAndRefreshConnection(
            connection,
            projectId,
            runtimeLog,
        )
    },
})

export async function executeAdhocAction({
    projectId,
    pieceName,
    actionName,
    input = {},
    connectionExternalId,
    log,
}: {
    projectId: string
    pieceName: string
    actionName: string
    input?: Record<string, unknown>
    connectionExternalId?: string
    log: FastifyBaseLogger
}): Promise<McpToolResult> {
    const project = await projectService(log).getOneOrThrow(projectId)

    let connectionId: string | undefined
    let resolvedConnection: AppConnectionSchema | null = null
    if (connectionExternalId) {
        const connection = await appConnectionsRepo().findOneBy({
            projectIds: ArrayContains([projectId]),
            externalId: connectionExternalId,
        })
        if (connection) {
            connectionId = connection.id
            resolvedConnection = connection
        }
    }
    if (!connectionId) {
        // Find any connection in the project for this piece
        const connection = await appConnectionsRepo().findOneBy({
            projectIds: ArrayContains([projectId]),
            pieceName,
        })
        if (connection) {
            connectionId = connection.id
            resolvedConnection = connection
        }
    }
    if (!connectionId) {
        // Find any connection in the project
        const connection = await appConnectionsRepo().findOneBy({
            projectIds: ArrayContains([projectId]),
        })
        if (connection) {
            connectionId = connection.id
            resolvedConnection = connection
        }
    }
    if (!connectionId) {
        throw new Error('A connection must be created first before executing a tool.')
    }

    // MISSING is a placeholder row with no credentials attached (placeholder upserts
    // store status MISSING with a NO_AUTH value) — not a deleted or inaccessible
    // connection. Gate on it at the execution boundary (#546): an auth-requiring
    // action would otherwise fail deep inside the piece with an error far from the
    // cause, and a no-auth action would silently run against a credential-less row.
    let missingCredentialsWarning: string | undefined
    if (resolvedConnection?.status === AppConnectionStatus.MISSING) {
        const connectionLabel = `"${resolvedConnection.displayName}" (${resolvedConnection.externalId})`
        if (await actionRequiresAuth({ pieceName, actionName, projectId, platformId: project.platformId, log })) {
            return mcpUtils.mcpToolError('Connection has no credentials', new Error(
                `Connection ${connectionLabel} for piece "${pieceName}" has no credentials attached (status: MISSING), and action "${actionName}" requires auth. Reconnect the connection with real credentials (Connections page or POST /api/v1/app-connections), or pass a connectionExternalId of an ACTIVE connection.`,
            ))
        }
        missingCredentialsWarning = `⚠️ Connection ${connectionLabel} has no credentials attached (status: MISSING). "${actionName}" ran because it does not require auth — actions that need this connection's credentials will fail until it is reconnected.`
    }

    // The runtime builds sandbox-internal URLs (store entries, files, piece bundles) by
    // appending `v1/...` to this value, so it must carry the `/api` prefix — the raw
    // AP_FRONTEND_URL previously made `new URL()` throw "Invalid URL" for every
    // store-touching action (#544). The engine token is generated per execution: the
    // store/files routes verify it as a real ENGINE principal and reject placeholder
    // strings with 401.
    const publicUrl = await domainHelper.getPublicApiUrl({ path: '' })
    const engineToken = await accessTokenManager(log).generateEngineToken({
        projectId,
        platformId: project.platformId,
    })
    const result = await runtime.execute({
        integration: pieceName,
        tool: actionName,
        connectionId,
        input,
        projectId,
        platformId: project.platformId,
        engineToken,
        internalApiUrl: publicUrl,
        publicApiUrl: publicUrl,
    })

    const text = `${missingCredentialsWarning ? `${missingCredentialsWarning}\n\n` : ''}Result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
    return {
        content: [{ type: 'text', text }],
        ...(missingCredentialsWarning ? { structuredContent: { warning: missingCredentialsWarning, result } } : {}),
    }
}

async function actionRequiresAuth({ pieceName, actionName, projectId, platformId, log }: ActionRequiresAuthParams): Promise<boolean> {
    const normalized = mcpUtils.normalizePieceName(pieceName)
    if (isNil(normalized)) {
        return false
    }
    const { data: piece, error } = await tryCatch(() => pieceMetadataService(log).get({ name: normalized, projectId, platformId }))
    // Unknown piece or action: do not block here — the engine surfaces a clear
    // piece/action-not-found failure of its own on execution.
    if (error || isNil(piece) || isNil(piece.actions[actionName])) {
        return false
    }
    return piece.actions[actionName].requireAuth
}

type ActionRequiresAuthParams = {
    pieceName: string
    actionName: string
    projectId: string
    platformId: string
    log: FastifyBaseLogger
}
