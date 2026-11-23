import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddAppCredentialProjectIdAppNameUniqueIndex1791869464750 implements Migration {
    name = 'AddAppCredentialProjectIdAppNameUniqueIndex1791869464750'
    breaking = false
    release = '0.88.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // The pre-fix upsert conflicted on ['id'] with a freshly generated id per call,
        // so every POST without a client-supplied id was a bare INSERT: deployments can
        // already hold several rows for one logical (projectId, appName) credential.
        // Keep the oldest row per natural key (created ASC, id ASC as a stable
        // tie-breaker — the row every reader has been served) and drop the rest,
        // otherwise CREATE UNIQUE INDEX fails on those databases.
        await queryRunner.query(`
            WITH ranked AS (
                SELECT "id", ROW_NUMBER() OVER (PARTITION BY "projectId", "appName" ORDER BY "created" ASC, "id" ASC) AS rn
                FROM "app_credential"
            )
            DELETE FROM "app_credential"
            WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1)
        `)
        await queryRunner.query('CREATE UNIQUE INDEX "idx_app_credential_project_id_app_name" ON "app_credential" ("projectId", "appName")')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_app_credential_project_id_app_name"')
    }
}
