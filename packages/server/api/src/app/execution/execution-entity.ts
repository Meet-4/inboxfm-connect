import { Execution, Platform, Project, User } from '@inboxfm-connect/shared'
import { EntitySchema } from 'typeorm'
import { ApIdSchema, BaseColumnSchemaPart } from '../database/database-common'

export const ExecutionEntity = new EntitySchema<ExecutionSchema>({
    name: 'execution',
    columns: {
        ...BaseColumnSchemaPart,
        projectId: {
            ...ApIdSchema,
            nullable: false,
        },
        platformId: {
            ...ApIdSchema,
            nullable: false,
        },
        userId: {
            ...ApIdSchema,
            nullable: true,
        },
        status: {
            type: String,
            nullable: false,
        },
        prompt: {
            type: String,
            nullable: false,
        },
        metadata: {
            type: 'json',
            nullable: false,
        },
        tokenUsage: {
            type: 'json',
            nullable: true,
        },
        cost: {
            type: 'numeric',
            nullable: true,
        },
        finishTime: {
            type: 'timestamp with time zone',
            nullable: true,
        },
    },
    indices: [
        {
            name: 'idx_execution_project_id',
            columns: ['projectId'],
        },
        {
            name: 'idx_execution_platform_id',
            columns: ['platformId'],
        },
        {
            name: 'idx_execution_status',
            columns: ['status'],
        },
        {
            name: 'idx_execution_created',
            columns: ['created'],
        },
        {
            // Hot path: `GET /v1/executions` builds
            // `WHERE projectId = :projectId ORDER BY created DESC LIMIT limit+1`
            // (execution.service#list via buildPaginator). The single-column
            // idx_execution_project_id forces a sort of every execution in the
            // project on each page fetch, and idx_execution_created cannot
            // filter by tenant — the planner either scans the whole timeline
            // or sorts the project's full history. The composite keeps the
            // tenant filter and the cursor ordering in one index walk, so a
            // page fetch touches only the rows it returns.
            name: 'idx_execution_project_id_created',
            columns: ['projectId', 'created'],
        },
    ],
    relations: {
        project: {
            type: 'many-to-one',
            target: 'project',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'projectId',
                foreignKeyConstraintName: 'fk_execution_project_id',
            },
        },
        platform: {
            type: 'many-to-one',
            target: 'platform',
            cascade: true,
            onDelete: 'CASCADE',
            joinColumn: {
                name: 'platformId',
                foreignKeyConstraintName: 'fk_execution_platform_id',
            },
        },
        user: {
            type: 'many-to-one',
            target: 'user',
            cascade: true,
            onDelete: 'SET NULL',
            joinColumn: {
                name: 'userId',
                foreignKeyConstraintName: 'fk_execution_user_id',
            },
        },
    },
})

export type ExecutionSchema = Execution & {
    project: Project
    platform: Platform
    user?: User | null
}
