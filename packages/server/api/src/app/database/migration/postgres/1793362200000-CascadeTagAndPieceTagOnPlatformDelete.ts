import { QueryRunner } from 'typeorm'
import { Migration } from '../../migration'

export class CascadeTagAndPieceTagOnPlatformDelete1793362200000 implements Migration {
    name = 'CascadeTagAndPieceTagOnPlatformDelete1793362200000'
    breaking = false
    release = '0.87.0'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // tag/piece_tag were the only platform-scoped tables whose platformId (and
        // piece_tag.tagId) FKs still defaulted to ON DELETE NO ACTION — the entities
        // never declared onDelete. hardDeletePlatformHandler (platform-jobs.ts) deletes
        // the platform row in one statement relying on DB cascades (it has explicit
        // cleanup only for the owner user row and the user_identity), so for any
        // platform that ever saved a piece tag that DELETE failed with
        //   update or delete on table "platform" violates foreign key constraint
        //   "FK_9dec09e187398715b7f1e32a6cb" on table "tag"
        // rolled back, and — the scheduler does not retry throwing handlers — the
        // platform survived forever. This is the migration twin of the entity fix
        // (tag-entity.ts / piece-tag.entity.ts now declare onDelete: 'CASCADE');
        // constraint names are preserved so existing installs keep one constraint.
        await queryRunner.query(`
            ALTER TABLE "tag" DROP CONSTRAINT "FK_9dec09e187398715b7f1e32a6cb"
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag" DROP CONSTRAINT "FK_5f483919deb37416ff32594918a"
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag" DROP CONSTRAINT "FK_6ee5c7cca2b33700e400ea2703e"
        `)
        await queryRunner.query(`
            ALTER TABLE "tag"
            ADD CONSTRAINT "FK_9dec09e187398715b7f1e32a6cb" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag"
            ADD CONSTRAINT "FK_6ee5c7cca2b33700e400ea2703e" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag"
            ADD CONSTRAINT "FK_5f483919deb37416ff32594918a" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "piece_tag" DROP CONSTRAINT "FK_5f483919deb37416ff32594918a"
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag" DROP CONSTRAINT "FK_6ee5c7cca2b33700e400ea2703e"
        `)
        await queryRunner.query(`
            ALTER TABLE "tag" DROP CONSTRAINT "FK_9dec09e187398715b7f1e32a6cb"
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag"
            ADD CONSTRAINT "FK_5f483919deb37416ff32594918a" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "piece_tag"
            ADD CONSTRAINT "FK_6ee5c7cca2b33700e400ea2703e" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `)
        await queryRunner.query(`
            ALTER TABLE "tag"
            ADD CONSTRAINT "FK_9dec09e187398715b7f1e32a6cb" FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `)
    }
}
