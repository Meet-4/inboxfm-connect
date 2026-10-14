import { BaseModelSchema, Nullable } from '@inboxfm-connect/core-utils'
import { z } from 'zod'

export enum ScheduledTaskStatus {
    ENABLED = 'ENABLED',
    DISABLED = 'DISABLED',
}

export const ScheduledTask = z.object({
    ...BaseModelSchema,
    projectId: z.string(),
    platformId: z.string(),
    prompt: z.string(),
    cronExpression: z.string(),
    timezone: z.string().default('UTC'),
    status: z.enum(['ENABLED', 'DISABLED']),
    lastRunAt: Nullable(z.string()),
    nextRunAt: Nullable(z.string()),
})

export const CreateScheduledTaskRequest = z.object({
    projectId: z.string().optional(),
    platformId: z.string().optional(),
    prompt: z.string(),
    cronExpression: z.string(),
    timezone: z.string().optional(),
    status: z.enum(['ENABLED', 'DISABLED']).optional(),
})

export const UpdateScheduledTaskRequest = z.object({
    prompt: z.string().optional(),
    cronExpression: z.string().optional(),
    timezone: z.string().optional(),
    status: z.enum(['ENABLED', 'DISABLED']).optional(),
})

export type ScheduledTask = z.infer<typeof ScheduledTask>
export type CreateScheduledTaskRequest = z.infer<typeof CreateScheduledTaskRequest>
export type UpdateScheduledTaskRequest = z.infer<typeof UpdateScheduledTaskRequest>

/**
 * Cursor pagination for `GET /v1/scheduled-tasks`. The console already sends
 * cursor/limit on this route (automationsApi.listScheduledTasks + the infinite
 * query following `next`), but the route previously ignored them and returned
 * every task of the project in one unbounded query. Defaults to the repo's
 * established MAX_PAGE_SIZE so whole-page list views stay identical for every
 * realistic project, while larger projects get a `next` cursor instead of an
 * ever-growing payload.
 */
export const ListScheduledTasksRequestQuery = z.object({
    projectId: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional().default(500),
})
export type ListScheduledTasksRequestQuery = z.infer<typeof ListScheduledTasksRequestQuery>
