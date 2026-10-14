import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

/**
 * Composite index for the executions list hot path:
 * `GET /v1/executions` runs `WHERE "projectId" = $1 ORDER BY "created" DESC LIMIT 11`
 * (limit+1 for hasMore, built by execution.service#list through buildPaginator).
 *
 * The existing single-column indexes leave the planner two bad options at scale:
 * idx_execution_project_id fetches every execution of the project and sorts them,
 * or idx_execution_created walks the global timeline backwards filtering by
 * tenant. ("projectId", "created") serves the tenant filter and the cursor
 * ordering in one index scan, so each page touches only the rows it returns.
 * The table grows monotonically with execution traffic and rows are never
 * pruned, so the sort cost grows without bound without this.
 */
export class AddExecutionProjectCreatedIndex1791957000000 implements Migration {
    name = 'AddExecutionProjectCreatedIndex1791957000000'
    breaking = false
    release = '0.88.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE INDEX "idx_execution_project_id_created" ON "execution" ("projectId", "created")')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_execution_project_id_created"')
    }
}
