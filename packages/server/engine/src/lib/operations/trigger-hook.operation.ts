import { inspect } from 'util'
import { formatPieceError } from '@inboxfm-connect/core-utils'
import { EngineResponse, EngineResponseStatus, ExecuteTriggerOperation, ExecuteTriggerResponse, ExecutionError, ExecutionErrorType, TriggerHookType } from '@inboxfm-connect/shared'
import { EngineConstants, ResolvedExecuteTriggerOperation } from '../handler/context/engine-constants'
import { triggerHelper } from '../helper/trigger-helper'
import { utils } from '../utils'
import { resolveJobPayload } from './utils/resolve-job-payload'


export const triggerHookOperation = {
    execute: async (operation: ExecuteTriggerOperation<TriggerHookType>): Promise<EngineResponse<ExecuteTriggerResponse<TriggerHookType>>> => {
        const input: ResolvedExecuteTriggerOperation<TriggerHookType> = {
            ...operation,
            triggerPayload: await resolveJobPayload({
                payload: operation.triggerPayload,
                apiUrl: operation.internalApiUrl,
                engineToken: operation.engineToken,
            }),
        }
        const { data: output, error } = await utils.tryCatchAndThrowOnEngineError(() =>
            triggerHelper.executeTrigger({
                params: input,
                constants: EngineConstants.fromExecuteTriggerInput(input),
            }),
        )
        if (error) {
            // Mirror the classification in operations/index.ts: only USER-level
            // ExecutionErrors are user failures. Anything else — a plain TypeError
            // from piece trigger code, a non-ExecutionError crash — is an internal
            // failure: label it INTERNAL_ERROR and log it, instead of silently
            // reporting an engine bug as the user's fault (and losing the crash
            // from the engine's error log).
            const isUserError = error instanceof ExecutionError && error.type === ExecutionErrorType.USER
            if (!isUserError) {
                console.error(error)
            }
            return {
                status: isUserError ? EngineResponseStatus.USER_FAILURE : EngineResponseStatus.INTERNAL_ERROR,
                response: undefined as unknown as ExecuteTriggerResponse<TriggerHookType>,
                error: JSON.stringify(formatPieceError(error, { raw: inspect(error) })),
            }
        }
        return {
            status: EngineResponseStatus.OK,
            response: output,
        }
    },
}