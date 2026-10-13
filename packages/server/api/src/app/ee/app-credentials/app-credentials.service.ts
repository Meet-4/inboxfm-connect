import { apId, Cursor, ProjectId, SeekPage } from '@inboxfm-connect/core-utils'
import { AppCredential, AppCredentialId, UpsertAppCredentialRequest } from '@inboxfm-connect/shared'
import { repoFactory } from '../../core/db/repo-factory'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { AppCredentialEntity } from './app-credentials.entity'

export const appCredentialRepo = repoFactory(AppCredentialEntity)

export const appCredentialService = {
    async list(
        projectId: ProjectId,
        appName: string | undefined,
        cursorRequest: Cursor | null,
        limit: number,
    ): Promise<SeekPage<AppCredential>> {
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest ?? null)
        const paginator = buildPaginator({
            entity: AppCredentialEntity,
            query: {
                limit,
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })
        let queryBuilder = appCredentialRepo()
            .createQueryBuilder('app_credential')
            .where({ projectId })
        if (appName !== undefined) {
            // Issue #415: TypeORM's second .where() RESETS expressionMap.wheres
            // (SelectQueryBuilder.js:341), which dropped the projectId scoping and
            // listed every tenant's rows. Compose instead of replace.
            queryBuilder = queryBuilder.andWhere({ appName })
        }
        const { data, cursor } = await paginator.paginate(queryBuilder)
        return paginationHelper.createPage<AppCredential>(data, cursor)
    },
    async getOneOrThrow(id: AppCredentialId): Promise<AppCredential> {
        return appCredentialRepo().findOneByOrFail({ id })
    },
    async upsert({
        projectId,
        request,
    }: {
        projectId: ProjectId
        request: UpsertAppCredentialRequest
    }): Promise<AppCredential | null> {
        // TypeORM's `upsert()` derives the DO UPDATE set from every supplied column
        // outside the conflict target, so conflicting on ['id'] with a fresh id per
        // call made every POST a bare INSERT — two calls for the same app created two
        // rows for one logical credential, and the read-back below served an arbitrary
        // one. The insert targets the natural key (projectId, appName) — backed by a
        // unique index — with an explicit overwrite list, so a conflicting call only
        // updates `settings` in place and the row id is never rewritten. The row is
        // read back afterwards because InsertResult.identifiers echoes the id
        // generated for this call, not the one already stored.
        await appCredentialRepo()
            .createQueryBuilder()
            .insert()
            .into(AppCredentialEntity)
            .values({
                id: request.id ?? apId(),
                appName: request.appName,
                settings: request.settings,
                projectId,
            })
            .orUpdate(['settings'], ['projectId', 'appName'])
            .execute()
        return appCredentialRepo().findOneBy({ projectId, appName: request.appName })
    },
    async delete({ id, projectId }: DeleteParams): Promise<void> {
        await appCredentialRepo().delete({
            id,
            projectId,
        })
    },
}

type DeleteParams = {
    id: AppCredentialId
    projectId: ProjectId
}
