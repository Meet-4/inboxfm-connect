import { vector } from '@electric-sql/pglite/vector'
import { DataSource } from 'typeorm'
import { PGliteDriver } from 'typeorm-pglite'
import { getMigrations } from '../../../../src/app/database/postgres-connection'

/**
 * Platform hard delete (platform.controller DELETE /:id -> HARD_DELETE_PLATFORM job ->
 * platform-jobs.ts#hardDeletePlatformHandler) issues a single
 * `platformRepo(entityManager).delete({ id: platformId })` inside a transaction and
 * relies entirely on ON DELETE CASCADE for every platform-scoped table — the handler
 * only deletes the platform row, the owner user row and (when no other user references
 * it) the identity. Any platform-scoped table whose platformId FK is ON DELETE NO
 * ACTION makes that DELETE fail with an FK violation, roll back the whole
 * transaction, and — because the in-process scheduler does not retry a handler that
 * throws — the platform silently survives forever (see platform-jobs.ts header
 * comment for how that class of failure already needed one fix).
 *
 * `tag` and `piece_tag` are platform-scoped exactly like the ~20 tables around them
 * (execution, api_key, oauth_app, embed_subdomain, ... all CASCADE): piece tags are
 * created through the normal tag upsert path, so any platform that ever saved a tag
 * hits this. This suite boots the REAL migration chain (fresh in-memory PGlite,
 * migrationsRun) — the production fresh-install schema — instead of the entity
 * `synchronize` schema the rest of the test suite boots, because synchronize derives
 * the schema from the same entities and would hide exactly this drift between
 * entity intent and shipped migration SQL.
 */

const SEED = {
    identityId: 'idt_cascade_test_01',
    userId: 'usr_cascade_test_01',
    platformId: 'plt_cascade_test_01',
    tagId: 'tag_cascade_test_01',
    pieceTagId: 'ptg_cascade_test_01',
}

const createMigratedDataSource = (): DataSource => {
    return new DataSource({
        type: 'postgres',
        // No dataDir: in-memory PGlite, isolated per test run.
        driver: new PGliteDriver({ extensions: { vector } }).driver,
        migrationsRun: true,
        migrationsTransactionMode: 'each',
        migrations: getMigrations(),
        synchronize: false,
    })
}

async function seedPlatformWithTags(ds: DataSource): Promise<void> {
    // Minimal user_identity + user + platform chain: platform.ownerId and
    // user.identityId are FK'd (RESTRICT / NO ACTION), so they must exist first.
    await ds.query(
        'INSERT INTO "user_identity" ("id", "email", "password", "firstName", "lastName", "provider") VALUES ($1, $2, $3, $4, $5, $6)',
        [SEED.identityId, 'cascade-test@example.com', 'not-a-hash', 'Cascade', 'Test', 'EMAIL'],
    )
    await ds.query(
        'INSERT INTO "user" ("id", "status", "platformRole", "identityId") VALUES ($1, $2, $3, $4)',
        [SEED.userId, 'ACTIVE', 'PLATFORM_ADMIN', SEED.identityId],
    )
    await ds.query(
        `INSERT INTO "platform" ("id", "ownerId", "name", "primaryColor", "logoIconUrl", "fullLogoUrl", "favIconUrl", "filteredPieceNames", "filteredPieceBehavior", "allowedAuthDomains", "enforceAllowedAuthDomains", "emailAuthEnabled", "federatedAuthProviders", "pinnedPieces") VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', 'ALLOWED', '{}', false, true, '{}', '{}')`,
        [SEED.platformId, SEED.userId, 'cascade-test-platform', '#000000', 'logo', 'full', 'fav'],
    )
    await ds.query(
        'INSERT INTO "tag" ("id", "platformId", "name") VALUES ($1, $2, $3)',
        [SEED.tagId, SEED.platformId, 'production-tag'],
    )
    await ds.query(
        'INSERT INTO "piece_tag" ("id", "platformId", "pieceName", "tagId") VALUES ($1, $2, $3, $4)',
        [SEED.pieceTagId, SEED.platformId, 'pieces/cascade-test', SEED.tagId],
    )
}

async function cleanupSeed(ds: DataSource): Promise<void> {
    // Child-first so cleanup also works while the delete still fails (RED state).
    await ds.query('DELETE FROM "piece_tag" WHERE "id" = $1', [SEED.pieceTagId]).catch(() => undefined)
    await ds.query('DELETE FROM "tag" WHERE "id" = $1', [SEED.tagId]).catch(() => undefined)
    await ds.query('DELETE FROM "platform" WHERE "id" = $1', [SEED.platformId]).catch(() => undefined)
    await ds.query('DELETE FROM "user" WHERE "id" = $1', [SEED.userId]).catch(() => undefined)
    await ds.query('DELETE FROM "user_identity" WHERE "id" = $1', [SEED.identityId]).catch(() => undefined)
}

async function countRows(ds: DataSource, table: string, column: string, value: string): Promise<number> {
    const result = await ds.query(
        `SELECT COUNT(*)::int AS "count" FROM "${table}" WHERE "${column}" = $1`,
        [value],
    )
    return result[0].count
}

describe('platform hard delete cascades (migration-booted schema)', () => {
    let ds: DataSource

    beforeAll(async () => {
        ds = createMigratedDataSource()
        await ds.initialize()
    })

    afterAll(async () => {
        await ds.destroy()
    })

    afterEach(async () => {
        await cleanupSeed(ds)
    })

    it('deleting a platform that has piece tags cascades tag and piece_tag rows', async () => {
        await seedPlatformWithTags(ds)

        // This is the exact statement hardDeletePlatformHandler issues via
        // platformRepo().delete({ id }) — with NO ACTION FKs it rejects with
        // 'violates foreign key constraint ... on table "tag"'.
        await expect(
            ds.query('DELETE FROM "platform" WHERE "id" = $1', [SEED.platformId]),
        ).resolves.toBeDefined()

        expect(await countRows(ds, 'tag', 'platformId', SEED.platformId)).toBe(0)
        expect(await countRows(ds, 'piece_tag', 'platformId', SEED.platformId)).toBe(0)
        expect(await countRows(ds, 'piece_tag', 'tagId', SEED.tagId)).toBe(0)
    })

    it('platform-scoped tag FKs are declared ON DELETE CASCADE by the migrations', async () => {
        await seedPlatformWithTags(ds)

        const constraints = await ds.query(
            `SELECT "conname", "confdeltype" FROM "pg_constraint"
             WHERE "conname" IN ('FK_9dec09e187398715b7f1e32a6cb', 'FK_5f483919deb37416ff32594918a', 'FK_6ee5c7cca2b33700e400ea2703e')
             ORDER BY "conname"`,
        )

        expect(constraints).toHaveLength(3)
        for (const constraint of constraints) {
            // confdeltype 'c' = ON DELETE CASCADE; 'a' = NO ACTION (the bug).
            expect(
                constraint.confdeltype,
                `${constraint.conname} must cascade on delete`,
            ).toBe('c')
        }
    })
})
