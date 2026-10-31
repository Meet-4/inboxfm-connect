import { CreateScheduledTaskRequest, Permission, PrincipalType, UpdateScheduledTaskRequest } from '@inboxfm-connect/shared'
import { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { StatusCodes } from 'http-status-codes'
import { z } from 'zod'
import { ProjectResourceType, ProjectTableResource } from '../../core/security/authorization/common'
import { securityAccess } from '../../core/security/authorization/fastify-security'
import { ScheduledTaskEntity } from './scheduled-task-entity'
import { scheduledTaskService } from './scheduled-task.service'

export const scheduledTaskController: FastifyPluginAsyncZod = async (fastify) => {
    fastify.post('/', CreateScheduledTaskRouteOptions, async (request, reply) => {
        const projectId = request.projectId
        const platformId = request.principal.platform.id
        const task = await scheduledTaskService.create({
            request: request.body,
            projectId,
            platformId,
        })
        return reply.status(StatusCodes.CREATED).send(task)
    })

    fastify.get('/', ListScheduledTasksRouteOptions, async (request) => {
        const projectId = request.projectId
        const platformId = request.principal.platform.id
        return scheduledTaskService.list({
            projectId,
            platformId,
            cursorRequest: request.query.cursor ?? null,
            limit: request.query.limit,
        })
    })

    fastify.get('/:id', GetScheduledTaskRouteOptions, async (request) => {
        const projectId = request.projectId
        const platformId = request.principal.platform.id
        return scheduledTaskService.getOneOrThrow({
            id: request.params.id,
            projectId,
            platformId,
        })
    })

    fastify.post('/:id', UpdateScheduledTaskRouteOptions, async (request) => {
        const projectId = request.projectId
        const platformId = request.principal.platform.id
        return scheduledTaskService.update({
            id: request.params.id,
            projectId,
            platformId,
            request: request.body,
        })
    })

    fastify.delete('/:id', DeleteScheduledTaskRouteOptions, async (request, reply) => {
        const projectId = request.projectId
        const platformId = request.principal.platform.id
        await scheduledTaskService.delete({
            id: request.params.id,
            projectId,
            platformId,
        })
        return reply.status(StatusCodes.NO_CONTENT).send()
    })

    fastify.post('/:id/run', RunScheduledTaskRouteOptions, async (request) => {
        const projectId = request.projectId
        const platformId = request.principal.platform.id
        return scheduledTaskService.triggerNow({
            id: request.params.id,
            projectId,
            platformId,
        })
    })
}

/**
 * Every `/:id` route exposes `:id`, never `:projectId`, so ProjectResourceType.PARAM
 * resolved `undefined` and rejected all USER principals. TABLE derives the tenant
 * from the scheduled_task row, so ownership is never client-supplied.
 */
const ScheduledTaskProjectResource: ProjectTableResource = {
    type: ProjectResourceType.TABLE,
    tableName: ScheduledTaskEntity,
}

const CreateScheduledTaskRouteOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_RUN,
            { type: ProjectResourceType.BODY },
        ),
    },
    schema: {
        body: CreateScheduledTaskRequest,
    },
}

const ListScheduledTasksRouteOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_RUN,
            { type: ProjectResourceType.QUERY },
        ),
    },
    schema: {
        tags: ['scheduled-tasks'],
        // `projectId` stays optional: it is enforced by the QUERY resource
        // check, not by zod, so an omitted projectId still produces the
        // security-layer rejection the authorization tests assert (403).
        // (`ApId` is a zod-mini schema with no `.optional()`, hence plain
        // z.string(); the security layer does its own format validation.)
        querystring: z.object({
            projectId: z.string().optional(),
            cursor: z.string().optional(),
            limit: z.string().optional(),
        }),
    },
}

const GetScheduledTaskRouteOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.READ_RUN,
            ScheduledTaskProjectResource,
        ),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
    },
}

const UpdateScheduledTaskRouteOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_RUN,
            ScheduledTaskProjectResource,
        ),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
        body: UpdateScheduledTaskRequest,
    },
}

const DeleteScheduledTaskRouteOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_RUN,
            ScheduledTaskProjectResource,
        ),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
    },
}

const RunScheduledTaskRouteOptions = {
    config: {
        security: securityAccess.project(
            [PrincipalType.USER, PrincipalType.SERVICE],
            Permission.WRITE_RUN,
            ScheduledTaskProjectResource,
        ),
    },
    schema: {
        params: z.object({
            id: z.string(),
        }),
    },
}

