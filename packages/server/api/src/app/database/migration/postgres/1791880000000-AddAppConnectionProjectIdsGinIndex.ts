import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class AddAppConnectionProjectIdsGinIndex1791880000000 implements Migration {
    name = 'AddAppConnectionProjectIdsGinIndex1791880000000'
    breaking = false
    release = '0.88.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // The entity declares this index (app-connection.entity.ts) but with
        // `synchronize: false`, so TypeORM schema sync never manages it and the
        // CI drift check cannot see it missing. The squashed InitialSchema was
        // generated through that same sync path, so the index silently vanished
        // when the historical chain was collapsed — every deployment since has
        // answered `projectIds @> ARRAY[...]` (ArrayContains) queries with a
        // sequential scan. Restore it with plain SQL, mirroring the entity
        // declaration's name and GIN operator class (`@>` on arrays needs GIN;
        // a plain b-tree cannot serve it).
        await queryRunner.query('CREATE INDEX "idx_app_connection_project_ids_gin" ON "app_connection" USING gin ("projectIds")')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "idx_app_connection_project_ids_gin"')
    }
}
