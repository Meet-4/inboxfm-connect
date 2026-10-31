import { ActivepiecesError, apId, ErrorCode, isNil, sanitizeObjectForPostgresql } from '@inboxfm-connect/core-utils'
import { ExecutionEventType, ExecutionToolCallStatus, ToolCall, ToolCallError, toolCallUtils } from '@inboxfm-connect/shared'
import { repoFactory } from '../../core/db/repo-factory'
import { executionEventService } from '../execution-event.service'
import { ToolCallEntity, ToolCallSchema } from './tool-call-entity'

const toolCallRepo = repoFactory<ToolCallSchema>(ToolCallEntity)

/**
 * `GET /v1/executions/:id/tool-calls` used to return every matching row with
 * no bound — a runaway agent loop that logs a tool call per iteration would
 * drag the whole table (input/output payloads included) into one JSON
 * response. The response stays `ToolCall[]` (the timeline UI maps the array
 * directly), so the bound is a row cap: default 500, hard max 1000. Nothing
 * in the runtime writes tool-call rows yet, so today's consumers see no
 * change; the cap protects the contract the moment a writer lands.
 */
const DEFAULT_TOOL_CALLS_LIMIT = 500
const MAX_TOOL_CALLS_LIMIT = 1000

function clampToolCallsLimit(rawLimit: string | number | undefined): number {
    return Math.max(1, Math.min(Math.floor(Number(rawLimit ?? DEFAULT_TOOL_CALLS_LIMIT)) || DEFAULT_TOOL_CALLS_LIMIT, MAX_TOOL_CALLS_LIMIT))
}

const toolCallService = {
    async createPending({
        executionId,
        projectId,
        pieceName,
        pieceVersion,
        actionName,
        connectionId,
        input,
    }: {
        executionId: string
        projectId: string
        pieceName: string
        pieceVersion: string
        actionName: string
        connectionId?: string | null
        input: Record<string, unknown>
    }): Promise<ToolCall> {
        const sanitizedInput = sanitizeObjectForPostgresql(input)

        const newToolCall: ToolCall = {
            id: apId(),
            executionId,
            projectId,
            pieceName,
            pieceVersion,
            actionName,
            connectionId: connectionId ?? null,
            input: sanitizedInput,
            output: null,
            status: ExecutionToolCallStatus.PENDING,
            error: null,
            latencyMs: null,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            finished: null,
        }

        return toolCallRepo().save(newToolCall)
    },

    async getOne({
        id,
        executionId,
        projectId,
    }: {
        id: string
        executionId: string
        projectId: string
    }): Promise<ToolCall> {
        const toolCall = await toolCallRepo().findOneBy({ id, executionId, projectId })
        if (isNil(toolCall)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    entityType: 'ToolCall',
                    entityId: id,
                },
            })
        }
        return toolCall
    },

    async markRunning({
        id,
        executionId,
        projectId,
    }: {
        id: string
        executionId: string
        projectId: string
    }): Promise<ToolCall> {
        const current = await this.getOne({ id, executionId, projectId })

        if (!toolCallUtils.isValidToolCallStatusTransition({ from: current.status, to: ExecutionToolCallStatus.RUNNING })) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Invalid tool call status transition from ${current.status} to ${ExecutionToolCallStatus.RUNNING}`,
                },
            })
        }

        await toolCallRepo().update(
            { id, executionId, projectId },
            {
                status: ExecutionToolCallStatus.RUNNING,
                updated: new Date().toISOString(),
            },
        )

        const updated = await this.getOne({ id, executionId, projectId })
        await executionEventService.emit({
            executionId,
            type: ExecutionEventType.ToolStarted,
            payload: {
                executionId,
                toolCallId: id,
                pieceName: updated.pieceName,
                actionName: updated.actionName,
                input: updated.input,
            },
        })

        return updated
    },

    async markSucceeded({
        id,
        executionId,
        projectId,
        output,
        latencyMs,
    }: {
        id: string
        executionId: string
        projectId: string
        output: unknown
        latencyMs: number
    }): Promise<ToolCall> {
        const current = await this.getOne({ id, executionId, projectId })

        if (!toolCallUtils.isValidToolCallStatusTransition({ from: current.status, to: ExecutionToolCallStatus.SUCCEEDED })) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Invalid tool call status transition from ${current.status} to ${ExecutionToolCallStatus.SUCCEEDED}`,
                },
            })
        }

        const sanitizedOutput = sanitizeObjectForPostgresql(output) as Record<string, unknown>

        await toolCallRepo().update(
            { id, executionId, projectId },
            {
                status: ExecutionToolCallStatus.SUCCEEDED,
                output: sanitizedOutput,
                latencyMs,
                finished: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
        )

        const updated = await this.getOne({ id, executionId, projectId })
        await executionEventService.emit({
            executionId,
            type: ExecutionEventType.ToolFinished,
            payload: {
                executionId,
                toolCallId: id,
                status: ExecutionToolCallStatus.SUCCEEDED,
                output: updated.output,
                latencyMs,
            },
        })

        return updated
    },

    async markFailed({
        id,
        executionId,
        projectId,
        error,
        latencyMs,
    }: {
        id: string
        executionId: string
        projectId: string
        error: ToolCallError
        latencyMs: number
    }): Promise<ToolCall> {
        const current = await this.getOne({ id, executionId, projectId })

        if (!toolCallUtils.isValidToolCallStatusTransition({ from: current.status, to: ExecutionToolCallStatus.FAILED })) {
            throw new ActivepiecesError({
                code: ErrorCode.VALIDATION,
                params: {
                    message: `Invalid tool call status transition from ${current.status} to ${ExecutionToolCallStatus.FAILED}`,
                },
            })
        }

        await toolCallRepo().update(
            { id, executionId, projectId },
            {
                status: ExecutionToolCallStatus.FAILED,
                error,
                latencyMs,
                finished: new Date().toISOString(),
                updated: new Date().toISOString(),
            },
        )

        const updated = await this.getOne({ id, executionId, projectId })
        await executionEventService.emit({
            executionId,
            type: ExecutionEventType.ToolFailed,
            payload: {
                executionId,
                toolCallId: id,
                error: updated.error ?? error,
            },
        })

        return updated
    },

    async listForExecution({
        executionId,
        projectId,
        limit,
    }: {
        executionId: string
        projectId: string
        limit?: string | number
    }): Promise<ToolCall[]> {
        return toolCallRepo().find({
            where: { executionId, projectId },
            order: { created: 'ASC' },
            take: clampToolCallsLimit(limit),
        })
    },
}

export { toolCallService }
