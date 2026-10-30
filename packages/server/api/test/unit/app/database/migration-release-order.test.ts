import { isNil } from '@inboxfm-connect/core-utils'
import semver from 'semver'
import { describe, expect, it } from 'vitest'
import { getMigrations } from '../../../../src/app/database/postgres-connection'

/**
 * rollbackToVersion (rollback-migrations.ts) reverts migrations whose `release` is
 * greater than the target using TypeORM's undoLastMigration — a strict
 * suffix-of-executed-history operation: it can only peel migrations off the END of
 * the migrations table, newest first. identifyReleaseCandidates selects candidates
 * purely by `release > target`, so for the rollback to be possible at all, the
 * set it selects must BE a contiguous suffix of the registered list.
 *
 * That holds exactly when release labels are non-decreasing in registration
 * (execution) order. If a later-executing migration carries a SMALLER release
 * label than an earlier one (or a bigger label executes before smaller ones,
 * like the 0.88.0-labeled agent migration running before three 0.87.0 ones),
 * verifyDatabaseState correctly aborts — but then it aborts for EVERY target
 * version, and the tool can never roll anything back: the error it reports
 * ("Migration order mismatch: expected X at position N...") reads like database
 * corruption when the real cause is uncoordinated hand-written release metadata.
 */
describe('registered migration release metadata (rollback contract)', () => {
    it('release labels are non-decreasing in execution order', () => {
        const labeled = getMigrations()
            .map((MigrationClass) => new MigrationClass())
            .filter((migration) => !isNil(migration.release))

        expect(labeled.length).toBeGreaterThan(0)

        for (let i = 1; i < labeled.length; i++) {
            const previous = labeled[i - 1].release!
            const current = labeled[i].release!

            expect(
                semver.lte(previous, current),
                `Migration "${labeled[i].name}" (release ${current}) executes after "${labeled[i - 1].name}" (release ${previous}), ` +
                'so its release label cannot be lower — rollbackToVersion selects candidates by release alone ' +
                'but can only revert a contiguous suffix of executed migrations (see rollback-migrations.ts).',
            ).toBe(true)
        }
    })

    it('every distinct release cut is a rollback target whose candidates form a suffix of the registered list', () => {
        const migrations = getMigrations().map((MigrationClass) => new MigrationClass())
        const labeled = migrations.filter((migration) => !isNil(migration.release))
        const releaseValues = [...new Set(labeled.map((migration) => migration.release!))]

        for (const release of releaseValues) {
            // The targets an operator would actually pass to `rollback --to`:
            // the release itself (revert everything above it) and the version
            // just below it (revert the release too).
            for (const target of [release, semver.inc(release, 'patch')!]) {
                const candidates = migrations.filter((migration) => {
                    if (isNil(migration.release)) {
                        return false
                    }
                    return semver.gt(migration.release, target)
                })

                // Candidates must be the LAST `candidates.length` labeled migrations.
                const expectedSuffix = labeled.slice(labeled.length - candidates.length)
                expect(
                    candidates.map((migration) => migration.name),
                    `rollbackToVersion(${target}) must select a contiguous suffix of the registered list`,
                ).toEqual(expectedSuffix.map((migration) => migration.name))
            }
        }
    })
})
