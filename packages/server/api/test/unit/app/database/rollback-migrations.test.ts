import { QueryRunner } from 'typeorm'
import { Migration } from '../../../../src/app/database/migration'
import { identifyCandidatesByManifest, identifyReleaseCandidates, verifyDatabaseState } from '../../../../src/app/database/rollback-migrations'

function createMockMigration(overrides: Partial<Migration> & { name: string }): new () => Migration {
    return class implements Migration {
        name = overrides.name
        breaking = overrides.breaking
        release = overrides.release
        async up(_queryRunner: QueryRunner): Promise<void> { /* noop */ }
        async down(_queryRunner: QueryRunner): Promise<void> { /* noop */ }
    }
}

function createMockDataSource(executedMigrationNames: string[]): { query: ReturnType<typeof vi.fn> } {
    return {
        query: vi.fn().mockResolvedValue(
            executedMigrationNames.map((name) => ({ name })),
        ),
    }
}

describe('identifyReleaseCandidates', () => {
    it('should return migrations with release greater than target version', () => {
        const migrations = [
            createMockMigration({ name: 'OldMigration', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'CurrentMigration', release: '0.77.0', breaking: false }),
            createMockMigration({ name: 'NewMigration', release: '0.78.0', breaking: false }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates).toHaveLength(1)
        expect(candidates[0].name).toBe('NewMigration')
    })

    it('should return multiple migrations in reverse order', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'M2', release: '0.78.0', breaking: false }),
            createMockMigration({ name: 'M3', release: '0.78.0', breaking: true }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates).toHaveLength(2)
        expect(candidates[0].name).toBe('M3')
        expect(candidates[1].name).toBe('M2')
    })

    it('should skip migrations without a release field', () => {
        const migrations = [
            createMockMigration({ name: 'NoRelease' }),
            createMockMigration({ name: 'HasRelease', release: '0.78.0', breaking: false }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates).toHaveLength(1)
        expect(candidates[0].name).toBe('HasRelease')
    })

    it('should return empty array when no migrations match', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'M2', release: '0.77.0', breaking: false }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates).toHaveLength(0)
    })

    it('should return empty array when all migrations lack release', () => {
        const migrations = [
            createMockMigration({ name: 'M1' }),
            createMockMigration({ name: 'M2' }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates).toHaveLength(0)
    })

    it('should clamp to a chain suffix when release labels are not monotonically increasing', () => {
        // Mirrors the real chain shape in postgres-connection.ts: a migration
        // labeled with an older release is registered after one labeled newer
        // (AddApiKeyExpiry '0.87.0' before AddPositionToField '0.86.1',
        // AddMcpOAuthTokenLineage '0.87.0' after AddAgentEntity '0.88.0').
        // Reverting the newer one while keeping the later-registered
        // older-labeled one applied is mechanically impossible with
        // undoLastMigration, so the candidate set must be a contiguous suffix.
        const migrations = [
            createMockMigration({ name: 'Initial', release: '0.85.0', breaking: false }),
            createMockMigration({ name: 'Expiry', release: '0.87.0', breaking: false }),
            createMockMigration({ name: 'Position', release: '0.86.1', breaking: false }),
            createMockMigration({ name: 'Agent', release: '0.88.0', breaking: false }),
            createMockMigration({ name: 'Lineage', release: '0.87.0', breaking: false }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.87.0')

        expect(candidates.map((m) => m.name)).toEqual(['Lineage', 'Agent'])
    })

    it('should revert everything after the first newer migration when an older-labeled migration is registered late', () => {
        const migrations = [
            createMockMigration({ name: 'Old', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'Newer', release: '0.78.0', breaking: false }),
            createMockMigration({ name: 'OlderButRegisteredLater', release: '0.76.1', breaking: false }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates.map((m) => m.name)).toEqual(['OlderButRegisteredLater', 'Newer'])
    })

    it('should include unlabeled migrations registered after the first newer migration', () => {
        const migrations = [
            createMockMigration({ name: 'Labeled', release: '0.78.0', breaking: false }),
            createMockMigration({ name: 'Unlabeled' }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates.map((m) => m.name)).toEqual(['Unlabeled', 'Labeled'])
    })

    it('should ignore invalid semver release labels instead of throwing', () => {
        const migrations = [
            createMockMigration({ name: 'Garbage', release: 'not-semver', breaking: false }),
            createMockMigration({ name: 'Valid', release: '0.78.0', breaking: false }),
        ]

        const candidates = identifyReleaseCandidates(migrations, '0.77.0')

        expect(candidates.map((m) => m.name)).toEqual(['Valid'])
    })
})

describe('identifyCandidatesByManifest', () => {
    it('should return migrations whose name is not in the manifest', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'M2', release: '0.77.0', breaking: false }),
            createMockMigration({ name: 'M3', release: '0.78.0', breaking: false }),
        ]

        const candidates = identifyCandidatesByManifest(migrations, ['M1', 'M2'])

        expect(candidates).toHaveLength(1)
        expect(candidates[0].name).toBe('M3')
    })

    it('should return multiple candidates in reverse (newest-first) order', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'M2', release: '0.77.0', breaking: false }),
            createMockMigration({ name: 'M3', release: '0.78.0', breaking: false }),
        ]

        const candidates = identifyCandidatesByManifest(migrations, ['M1'])

        expect(candidates).toHaveLength(2)
        expect(candidates[0].name).toBe('M3')
        expect(candidates[1].name).toBe('M2')
    })

    it('should exclude migrations with no name (falsy name skipped)', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: '', release: '0.77.0', breaking: false }),
        ]

        const candidates = identifyCandidatesByManifest(migrations, [])

        expect(candidates).toHaveLength(1)
        expect(candidates[0].name).toBe('M1')
    })

    it('should return empty array when all migrations are in the manifest', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'M2', release: '0.77.0', breaking: false }),
        ]

        const candidates = identifyCandidatesByManifest(migrations, ['M1', 'M2'])

        expect(candidates).toHaveLength(0)
    })

    it('should return all migrations when manifest is empty', () => {
        const migrations = [
            createMockMigration({ name: 'M1', release: '0.76.0', breaking: false }),
            createMockMigration({ name: 'M2', release: '0.77.0', breaking: false }),
        ]

        const candidates = identifyCandidatesByManifest(migrations, [])

        expect(candidates).toHaveLength(2)
        expect(candidates[0].name).toBe('M2')
        expect(candidates[1].name).toBe('M1')
    })
})

describe('verifyDatabaseState', () => {
    it('should pass when DB matches candidates', async () => {
        const candidates: Migration[] = [
            { name: 'M3', up: vi.fn(), down: vi.fn() },
            { name: 'M2', up: vi.fn(), down: vi.fn() },
        ]
        const mockDataSource = createMockDataSource(['M3', 'M2'])

        await expect(
            verifyDatabaseState(mockDataSource as unknown as Parameters<typeof verifyDatabaseState>[0], candidates),
        ).resolves.toBeUndefined()

        expect(mockDataSource.query).toHaveBeenCalledWith(
            'SELECT "name" FROM "migrations" ORDER BY "id" DESC LIMIT $1',
            [2],
        )
    })

    it('should throw when DB order does not match candidates', async () => {
        const candidates: Migration[] = [
            { name: 'M3', up: vi.fn(), down: vi.fn() },
            { name: 'M2', up: vi.fn(), down: vi.fn() },
        ]
        const mockDataSource = createMockDataSource(['M2', 'M3'])

        await expect(
            verifyDatabaseState(mockDataSource as unknown as Parameters<typeof verifyDatabaseState>[0], candidates),
        ).rejects.toThrow('Migration order mismatch')
    })

    it('should throw when DB has different migration names', async () => {
        const candidates: Migration[] = [
            { name: 'M3', up: vi.fn(), down: vi.fn() },
        ]
        const mockDataSource = createMockDataSource(['SomethingElse'])

        await expect(
            verifyDatabaseState(mockDataSource as unknown as Parameters<typeof verifyDatabaseState>[0], candidates),
        ).rejects.toThrow('Migration order mismatch')
    })
})
