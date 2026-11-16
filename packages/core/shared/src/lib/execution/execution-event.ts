import { z } from 'zod'

export enum ExecutionEventType {
    ExecutionStarted = 'ExecutionStarted',
    PlannerStarted = 'PlannerStarted',
    ToolStarted = 'ToolStarted',
    ToolFinished = 'ToolFinished',
    ToolFailed = 'ToolFailed',
    ExecutionCompleted = 'ExecutionCompleted',
    ExecutionFailed = 'ExecutionFailed',
    ExecutionCancelled = 'ExecutionCancelled',
}

export const CRITICAL_EXECUTION_EVENT_TYPES: ExecutionEventType[] = [
    ExecutionEventType.ExecutionStarted,
    ExecutionEventType.ExecutionCompleted,
    ExecutionEventType.ExecutionFailed,
    ExecutionEventType.ExecutionCancelled,
    ExecutionEventType.ToolFailed,
]

export const ExecutionStartedPayload = z.object({
    executionId: z.string(),
    prompt: z.string(),
    timestamp: z.string(),
})
export type ExecutionStartedPayload = z.infer<typeof ExecutionStartedPayload>

export const PlannerStartedPayload = z.object({
    executionId: z.string(),
    model: z.string(),
    timestamp: z.string(),
})
export type PlannerStartedPayload = z.infer<typeof PlannerStartedPayload>

export const ToolStartedPayload = z.object({
    executionId: z.string(),
    toolCallId: z.string(),
    pieceName: z.string(),
    actionName: z.string(),
    input: z.record(z.string(), z.unknown()),
})
export type ToolStartedPayload = z.infer<typeof ToolStartedPayload>

export const ToolFinishedPayload = z.object({
    executionId: z.string(),
    toolCallId: z.string(),
    output: z.unknown(),
    latencyMs: z.number(),
})
export type ToolFinishedPayload = z.infer<typeof ToolFinishedPayload>

export const ToolFailedPayload = z.object({
    executionId: z.string(),
    toolCallId: z.string(),
    error: z.object({
        message: z.string(),
        code: z.string().optional(),
        stack: z.string().optional(),
    }),
})
export type ToolFailedPayload = z.infer<typeof ToolFailedPayload>

export const ExecutionCompletedPayload = z.object({
    executionId: z.string(),
    output: z.unknown().optional(),
    totalTokens: z.number().nullable().optional(),
    durationMs: z.number().nullable().optional(),
    // The api's execution.service emits finishTime on Completion (alongside
    // totalTokens) — it was missing from this contract, so parsing the real
    // emission silently stripped it.
    finishTime: z.string().nullable().optional(),
})
export type ExecutionCompletedPayload = z.infer<typeof ExecutionCompletedPayload>

export const ExecutionFailedPayload = z.object({
    executionId: z.string(),
    error: z.object({
        message: z.string(),
        code: z.string().optional(),
    }),
})
export type ExecutionFailedPayload = z.infer<typeof ExecutionFailedPayload>

export const ExecutionCancelledPayload = z.object({
    executionId: z.string(),
    reason: z.string().optional(),
})
export type ExecutionCancelledPayload = z.infer<typeof ExecutionCancelledPayload>

export const ExecutionEvent = z.object({
    id: z.string(),
    executionId: z.string(),
    type: z.nativeEnum(ExecutionEventType),
    timestamp: z.string(),
    payload: z.record(z.string(), z.unknown()),
})
export type ExecutionEvent = z.infer<typeof ExecutionEvent>
