import { ActivepiecesError, apId, Cursor, ErrorCode, isNil, ProjectId, SeekPage } from '@inboxfm-connect/core-utils'
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
        // A caller-supplied id must never reach the upsert conflict target
        // unscoped: ON CONFLICT (id) DO UPDATE rewrites every other column,
        // including projectId, so a body carrying another project's credential
        // id would silently re-own that row (and clobber its OAuth settings,
        // which connection-key creation consumes). Resolve the id inside the
        // caller's project first — an id that is not ours is a 404, never an
        // update — then update in place and read back by primary key.
        if (!isNil(request.id)) {
            const owned = await appCredentialRepo().findOneBy({
                id: request.id,
                projectId,
            })
            if (isNil(owned)) {
                throw new ActivepiecesError({
                    code: ErrorCode.ENTITY_NOT_FOUND,
                    params: {
                        entityType: 'app_credential',
                        entityId: request.id,
                        message: 'App credential not found',
                    },
                })
            }
            await appCredentialRepo().update({
                id: owned.id,
                projectId,
            }, {
                appName: request.appName,
                settings: request.settings,
            })
            return appCredentialRepo().findOneByOrFail({
                id: owned.id,
                projectId,
            })
        }

        // No caller-supplied id: create against the natural key (projectId,
        // appName), backed by the unique index from migration
        // AddAppCredentialProjectIdAppNameUniqueIndex. Two POSTs for the same
        // app (double-click, retry, two operators) converge on one row — the
        // explicit overwrite list only touches `settings`, so the row id is
        // never rewritten. The row is read back by the natural key afterwards
        // because the insert's identifiers echo the id generated for this
        // call, not the one already stored for an existing key.
        await appCredentialRepo()
            .createQueryBuilder()
            .insert()
            .into(AppCredentialEntity)
            .values({
                id: apId(),
                appName: request.appName,
                settings: request.settings,
                projectId,
            })
            .orUpdate(['settings'], ['projectId', 'appName'])
            .execute()
        return appCredentialRepo().findOneByOrFail({
            projectId,
            appName: request.appName,
        })
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
