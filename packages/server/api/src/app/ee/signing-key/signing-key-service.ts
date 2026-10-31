import { ActivepiecesError, apId, ErrorCode, isNil, PlatformId, SeekPage } from '@inboxfm-connect/core-utils'
import { AddSigningKeyResponse, SigningKey, SigningKeyId } from '@inboxfm-connect/shared'
import { repoFactory } from '../../core/db/repo-factory'
import { buildPaginator } from '../../helper/pagination/build-paginator'
import { paginationHelper } from '../../helper/pagination/pagination-utils'
import { SigningKeyEntity } from './signing-key-entity'
import { signingKeyGenerator } from './signing-key-generator'

// Untyped generic (matching the user-service/execution-service convention) so
// the repository element type (SigningKeySchema, incl. the platform relation)
// lines up with buildPaginator's `entity: SigningKeyEntity`.
const repo = repoFactory(SigningKeyEntity)

/**
 * `GET /v1/signing-keys` used to return every key row for the platform in a
 * fake SeekPage (hard-coded null cursors). Real cursor pagination now bounds
 * each response. Default 100 because admin callers render one page with no
 * "load more" UI, so the default must exceed realistic key counts; hard max
 * follows the record-list convention (issue #400).
 */
const DEFAULT_LIST_LIMIT = 100
const MAX_LIST_LIMIT = 500

function clampListLimit(rawLimit: string | number | undefined): number {
    return Math.max(1, Math.min(Math.floor(Number(rawLimit ?? DEFAULT_LIST_LIMIT)) || DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT))
}

export const signingKeyService = {
    async add({ platformId, displayName }: AddParams): Promise<AddSigningKeyResponse> {
        const generatedSigningKey = await signingKeyGenerator.generate()

        const newSigningKey: NewSigningKey = {
            id: apId(),
            platformId,
            publicKey: generatedSigningKey.publicKey,
            algorithm: generatedSigningKey.algorithm,
            displayName,
        }

        const savedKeyPair = await repo().save(newSigningKey)

        return {
            ...savedKeyPair,
            privateKey: generatedSigningKey.privateKey,
        }
    },

    async list({ platformId, cursorRequest, limit }: ListParams): Promise<SeekPage<SigningKey>> {
        const decodedCursor = paginationHelper.decodeCursor(cursorRequest ?? null)
        const paginator = buildPaginator({
            entity: SigningKeyEntity,
            query: {
                limit: clampListLimit(limit),
                // Oldest first matches the pre-pagination display order.
                order: 'ASC',
                afterCursor: decodedCursor.nextCursor,
                beforeCursor: decodedCursor.previousCursor,
            },
        })

        const query = repo()
            .createQueryBuilder('signing_key')
            .where('signing_key.platformId = :platformId', { platformId })

        const { data, cursor } = await paginator.paginate(query)
        return paginationHelper.createPage<SigningKey>(data, cursor)
    },

    async get({ id, platformId }: GetParams): Promise<SigningKey | null> {
        // Scope to the caller's platform like delete() does: an unscoped id
        // lookup lets one platform's admin read another platform's key row
        // (publicKey metadata + owning platformId) by raw id (issue #375).
        return repo().findOneBy({
            id,
            platformId,
        })
    },

    async getById({ id }: GetByIdParams): Promise<SigningKey | null> {
        // Internal trust-anchor lookup for managed-authn: the key id arrives
        // in the JWT kid header and the platform is derived from the key row
        // itself, so this path cannot pre-scope — it must stay unscoped, but it
        // is not reachable from the admin REST surface.
        return repo().findOneBy({
            id,
        })
    },

    async delete({ platformId, id }: DeleteParams): Promise<void> {
        const entity = await repo().findOneBy({
            platformId,
            id,
        })
        if (isNil(entity)) {
            throw new ActivepiecesError({
                code: ErrorCode.ENTITY_NOT_FOUND,
                params: {
                    message: `signing key with id ${id} not found`,
                },
            })
        }
        await repo().delete({
            platformId,
            id,
        })
    },
}

type AddParams = {
    platformId: PlatformId
    displayName: string
}

type GetParams = {
    id: SigningKeyId
    platformId: PlatformId
}

type GetByIdParams = {
    id: SigningKeyId
}

type DeleteParams = {
    id: SigningKeyId
    platformId: PlatformId
}

type NewSigningKey = Omit<SigningKey, 'created' | 'updated'>

type ListParams = {
    platformId?: PlatformId
    cursorRequest?: string | null
    limit?: string | number
}
