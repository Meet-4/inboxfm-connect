import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddPositionToField1790153790769 implements Migration {
    name = 'AddPositionToField1790153790769'
    breaking = false
    // Labeled 0.87.0, not 0.86.1: this migration executes AFTER AddApiKeyExpiry
    // (0.87.0), and release labels must be non-decreasing in execution order or
    // rollbackToVersion can never revert a contiguous suffix (see
    // migration-release-order.test.ts). PR #90 predates the ApiKeyExpiry migration
    // being registered first; both are on the same unreleased train (repo version
    // is 0.86.1), so no already-shipped release contains either.
    release = '0.87.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "field" ADD COLUMN "position" integer')

        // Backfills existing rows from their current implicit order (created ASC, id ASC
        // as a stable tie-breaker for rows sharing the same "created" timestamp) so no
        // existing table visually reshuffles once "position" becomes the source of truth.
        await queryRunner.query(`
            WITH ordered AS (
                SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tableId" ORDER BY "created" ASC, "id" ASC) - 1 AS rn
                FROM "field"
            )
            UPDATE "field" SET "position" = ordered.rn
            FROM ordered
            WHERE "field"."id" = ordered."id"
        `)

        await queryRunner.query('ALTER TABLE "field" ALTER COLUMN "position" SET NOT NULL')

        // DEFERRABLE INITIALLY DEFERRED: position-mutating operations (insert-between,
        // reorder, delete) shift several sibling rows within one transaction, which
        // transiently revisits positions another row already holds. Deferring the
        // uniqueness check to COMMIT lets that shift succeed, while still giving the
        // database the final word if the shift logic (or the distributed lock guarding
        // it) is ever wrong - see field.service.ts.
        await queryRunner.query('ALTER TABLE "field" ADD CONSTRAINT "uq_field_table_id_position" UNIQUE ("tableId", "position") DEFERRABLE INITIALLY DEFERRED')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "field" DROP CONSTRAINT "uq_field_table_id_position"')
        await queryRunner.query('ALTER TABLE "field" DROP COLUMN "position"')
    }
}
