import { ActivepiecesError, ErrorCode, isEnumValue, isNil } from '@inboxfm-connect/core-utils'
import { cryptoUtils } from '@inboxfm-connect/server-utils'
import { CreateScimUserRequest, parseScimFilter, PlatformRole, ReplaceScimUserRequest, SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA, SCIM_LIST_RESPONSE_SCHEMA, SCIM_USER_SCHEMA, ScimError, ScimListResponse, ScimPatchRequest, ScimUserResource, User, UserIdentityProvider, UserStatus } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { userIdentityService } from '../../authentication/user-identity/user-identity-service'
import { distributedLock } from '../../database/redis-connections'
import { userService } from '../../user/user-service'
import { emailService } from '../helper/email/email-service'

// Postgres surfaces a unique violation as SQLSTATE 23505 on `code`, and pglite puts it
// on `driverError.code` instead - same shape as the other services in this package.
const isUniqueViolation = (error: unknown): boolean => {
    const candidate = error as { code?: unknown, driverError?: { code?: unknown } } | null
    return candidate?.code === '23505' || candidate?.driverError?.code === '23505'
}

// The create flow check-then-acts on two unique keys: (platformId, externalId) on the
// user row (idx_user_platform_id_external_id) and email on the identity. Two concurrent
// SCIM creates that both pass the pre-checks both proceed, and the loser of the
// externalId race blew up with a raw 23505 AFTER its user and personal project were
// already provisioned - leaving a user that can never be re-provisioned, because the
// retry then fails the email conflict check (409 'User with email already exists')
// while the row still has no externalId. Serialize SCIM user creates per platform
// (provisioning volume is low, so this is cheap) and re-run the whole flow inside the
// lock. Fail open when the lock is unavailable: the unique indexes still arbitrate,
// and the mapped 409s below keep the error contract intact.
const runCreateExclusiveOrWithoutLock = async <T>(params: {
    platformId: string
    log: FastifyBaseLogger
    fn: () => Promise<T>
}): Promise<T> => {
    const { platformId, log, fn } = params
    let fnSettled = false
    try {
        return await distributedLock(log).runExclusive({
            key: `scim:user:create:${platformId}`,
            timeoutInSeconds: 30,
            fn: async () => {
                try {
                    return await fn()
                }
                finally {
                    // Mark settled on EVERY exit path (throw AND success) so a
                    // lock-infra error after fn completed cannot fail open and run
                    // fn a second time.
                    fnSettled = true
                }
            },
        })
    }
    catch (error) {
        if (fnSettled) {
            throw error
        }
        log.warn({ error, platformId }, 'SCIM user create lock unavailable - failing open')
        return fn()
    }
}

export const scimUserService = (log: FastifyBaseLogger) => ({
    async create(params: {
        platformId: string
        request: CreateScimUserRequest
    }): Promise<ScimUserResource> {
        const { platformId, request } = params
        const email = request.userName.toLowerCase().trim()
        const firstName = request.name?.givenName ?? ''
        const lastName = request.name?.familyName ?? ''
        const externalId = request.externalId
        const active = request.active !== false
        const generatedPassword = await cryptoUtils.generateRandomPassword()
        const platformRole = request[SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]?.platformRole ?? PlatformRole.MEMBER

        return runCreateExclusiveOrWithoutLock({
            platformId,
            log,
            fn: async () => {
                if (!isNil(externalId)) {
                    const existingUser = await userService(log).getByPlatformAndExternalId({
                        platformId,
                        externalId,
                    })
                    if (!isNil(existingUser)) {
                        throw new ScimError(
                            StatusCodes.CONFLICT,
                            'User with external ID already exists',
                        )
                    }
                }

                let identity = await userIdentityService(log).getIdentityByEmail(email)
                if (isNil(identity)) {
                    try {
                        identity = await userIdentityService(log).create({
                            email,
                            firstName,
                            lastName,
                            password: generatedPassword,
                            trackEvents: false,
                            newsLetter: false,
                            provider: UserIdentityProvider.SAML,
                            verified: true,
                        })
                    }
                    catch (error) {
                        // The identity email key is global, so another platform's SCIM
                        // create can race this one past the lock and commit the identity
                        // first. Converge on the committed identity instead of surfacing
                        // a raw EXISTING_USER error out of a SCIM endpoint.
                        if (error instanceof ActivepiecesError && error.error.code === ErrorCode.EXISTING_USER) {
                            identity = await userIdentityService(log).getIdentityByEmail(email)
                        }
                        if (isNil(identity)) {
                            throw error
                        }
                    }
                }

                const existingUserForIdentity = await userService(log).getOneByIdentityAndPlatform({
                    identityId: identity.id,
                    platformId,
                })
                if (!isNil(existingUserForIdentity)) {
                    throw new ScimError(
                        StatusCodes.CONFLICT,
                        'User with email already exists',
                    )
                }

                const user = await userService(log).getOrCreateWithProject({
                    identity,
                    platformId,
                })

                try {
                    await userService(log).update({
                        id: user.id,
                        platformId,
                        status: active ? UserStatus.ACTIVE : UserStatus.INACTIVE,
                        platformRole,
                        externalId,
                    })
                }
                catch (error) {
                    // A non-SCIM path (e.g. a platform admin editing a user) can commit
                    // the same externalId between the pre-check and this write; the
                    // unique index idx_user_platform_id_external_id arbitrates - report
                    // the conflict per RFC 7644 instead of a raw driver error.
                    if (isUniqueViolation(error)) {
                        throw new ScimError(
                            StatusCodes.CONFLICT,
                            'User with external ID already exists',
                        )
                    }
                    throw error
                }

                await emailService(log).sendScimUserWelcome({
                    email,
                    platformId,
                })

                const finalUser = await userService(log).getOrThrow({ id: user.id })
                return toScimUserResource(finalUser, identity.email, identity.firstName, identity.lastName)
            },
        })
    },

    async getById(params: {
        platformId: string
        userId: string
    }): Promise<ScimUserResource> {
        const { platformId, userId } = params
        const user = await userService(log).get({ id: userId })

        if (isNil(user) || user.platformId !== platformId) {
            throw new ScimError(
                StatusCodes.NOT_FOUND,
                'User not found',
            )
        }

        const identity = await userIdentityService(log).getBasicInformation(user.identityId)
        return toScimUserResource(user, identity.email, identity.firstName, identity.lastName)
    },

    async list(params: {
        platformId: string
        filter?: string
        startIndex?: number
        count?: number
    }): Promise<ScimListResponse> {
        const { platformId, filter, startIndex = 1, count = 100 } = params

        // Parse SCIM filter - we support "userName eq \"value\""
        const filterEmail = parseScimFilter(filter, 'userName')

        if (!isNil(filterEmail)) {
            const identity = await userIdentityService(log).getIdentityByEmail(filterEmail)
            if (isNil(identity)) {
                return {
                    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
                    totalResults: 0,
                    startIndex,
                    itemsPerPage: count,
                    Resources: [],
                }
            }
            const user = await userService(log).getOneByIdentityAndPlatform({
                identityId: identity.id,
                platformId,
            })
            if (isNil(user)) {
                return {
                    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
                    totalResults: 0,
                    startIndex,
                    itemsPerPage: count,
                    Resources: [],
                }
            }
            return {
                schemas: [SCIM_LIST_RESPONSE_SCHEMA],
                totalResults: 1,
                startIndex,
                itemsPerPage: count,
                Resources: [toScimUserResource(user, identity.email, identity.firstName, identity.lastName)],
            }
        }

        const usersPage = await userService(log).list({
            platformId,
            cursorRequest: null,
            limit: count,
        })

        const scimUsers: ScimUserResource[] = await Promise.all(
            usersPage.data.map(async (user) => toScimUserResource(user, user.email, user.firstName, user.lastName)),
        )

        return {
            schemas: [SCIM_LIST_RESPONSE_SCHEMA],
            totalResults: scimUsers.length,
            startIndex,
            itemsPerPage: count,
            Resources: scimUsers,
        }
    },

    async replace(params: {
        platformId: string
        userId: string
        request: ReplaceScimUserRequest
    }): Promise<ScimUserResource> {
        const { platformId, userId, request } = params
        const user = await userService(log).get({ id: userId })

        if (isNil(user) || user.platformId !== platformId) {
            throw new ScimError(
                StatusCodes.NOT_FOUND,
                'User not found',
            )
        }

        const active = request.active !== false
        const status = active ? UserStatus.ACTIVE : UserStatus.INACTIVE

        await assertExternalIdIsAvailable({
            log,
            platformId,
            userId,
            externalId: request.externalId,
        })

        await updateUserGuardingExternalIdConflict({
            log,
            update: {
                id: userId,
                platformId,
                status,
                externalId: request.externalId,
                platformRole: request[SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]?.platformRole,
            },
        })

        await userIdentityService(log).update(user.identityId, {
            firstName: request.name?.givenName,
            lastName: request.name?.familyName,
        })
        const updatedIdentity = await userIdentityService(log).getBasicInformation(user.identityId)

        const updatedUser = await userService(log).getOrThrow({ id: userId })
        return toScimUserResource(updatedUser, updatedIdentity.email, updatedIdentity.firstName, updatedIdentity.lastName)
    },

    async patch(params: {
        platformId: string
        userId: string
        request: ScimPatchRequest
    }): Promise<ScimUserResource> {
        const { platformId, userId, request } = params
        const user = await userService(log).get({ id: userId })

        if (isNil(user) || user.platformId !== platformId) {
            throw new ScimError(
                StatusCodes.NOT_FOUND,
                'User not found',
            )
        }

        let addOperationFields: {
            platformRole?: PlatformRole
            firstName?: string
            lastName?: string
            externalId?: string
            active?: boolean
        } | undefined = undefined

        // Different providers do patch operations differently some use 'replace' some use 'add'
        for (const operation of request.Operations) {
            const op = operation.op.toLowerCase()

            if (op === 'replace') {
                const value = operation.value as Record<string, unknown>
                if (!isNil(value)) {
                    await assertExternalIdIsAvailable({
                        log,
                        platformId,
                        userId,
                        externalId: value.externalId as string | undefined,
                    })
                    await updateUserGuardingExternalIdConflict({
                        log,
                        update: {
                            id: userId,
                            platformId,
                            status: isNil(value.active) ? undefined : value.active ? UserStatus.ACTIVE : UserStatus.INACTIVE,
                            externalId: value.externalId as string,
                        },
                    })
                }

                // Handle path-based replace (e.g., "active" as path)
                if (operation.path === 'active') {
                    const active = operation.value as boolean
                    await userService(log).update({
                        id: userId,
                        platformId,
                        status: active ? UserStatus.ACTIVE : UserStatus.INACTIVE,
                    })
                }
            }
            else if ( op === 'add') {
                // Providers spell the custom-attribute sub-attribute path both
                // ways in the wild: RFC 7644 attribute notation (colon-separated)
                // and a dotted variant, and attribute names are case-insensitive
                // per RFC 7644 §2.1. Match any casing of either spelling, validate
                // the role once, and ignore every other unknown add path per
                // RFC 7644 §3.5.2 instead of falling through with an empty
                // pending-fields object.
                // RFC 7644 §3.5.2.1 allows omitting `path` when `value` is an
                // object (the replace branch above handles that form), so an
                // empty path must stay a no-op here instead of crashing.
                const path = (operation.path ?? '').toLowerCase()
                const platformRolePaths = [
                    `${SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA}:platformRole`.toLowerCase(),
                    `${SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA}.platformRole`.toLowerCase(),
                ]
                const isPlatformRolePath = platformRolePaths.includes(path)

                if (isPlatformRolePath) {
                    if (!isEnumValue(PlatformRole, operation.value as string)) {
                        throw new ScimError(
                            StatusCodes.BAD_REQUEST,
                            `Invalid platform role: ${operation.value}`,
                        )
                    }
                    addOperationFields = addOperationFields ?? {}
                    addOperationFields['platformRole'] = operation.value as PlatformRole
                }
                else {
                    switch (path) {
                        case 'name.givenname':
                            addOperationFields = addOperationFields ?? {}
                            addOperationFields['firstName'] = operation.value as string
                            break
                        case 'name.familyname':
                            addOperationFields = addOperationFields ?? {}
                            addOperationFields['lastName'] = operation.value as string
                            break
                        case 'externalid':
                            addOperationFields = addOperationFields ?? {}
                            addOperationFields['externalId'] = operation.value as string
                            break
                        case 'active':
                            addOperationFields = addOperationFields ?? {}
                            addOperationFields['active'] = operation.value as boolean
                            break
                    }
                }
            }
        }

        let updatedUser: User | undefined
        if (!isNil(addOperationFields)) {
            const { platformRole, firstName, lastName, externalId, active } = addOperationFields
            await assertExternalIdIsAvailable({
                log,
                platformId,
                userId,
                externalId,
            })
            await updateUserGuardingExternalIdConflict({
                log,
                update: {
                    platformId,
                    id: userId,
                    platformRole,
                    externalId,
                    status: isNil(active) ? undefined : active ? UserStatus.ACTIVE : UserStatus.INACTIVE,
                },
            })
            updatedUser = await userService(log).getOrThrow({ id: userId })
            await userIdentityService(log).update(updatedUser.identityId, { firstName, lastName })
        }

        updatedUser = updatedUser ?? await userService(log).getOrThrow({ id: userId })
        const identity = await userIdentityService(log).getBasicInformation(updatedUser.identityId)
        return toScimUserResource(updatedUser, identity.email, identity.firstName, identity.lastName)
    },

    async deactivate(params: {
        platformId: string
        userId: string
    }): Promise<void> {
        const { platformId, userId } = params
        const user = await userService(log).get({ id: userId })

        if (isNil(user) || user.platformId !== platformId) {
            throw new ScimError(
                StatusCodes.NOT_FOUND,
                'User not found',
            )
        }

        await userService(log).update({
            id: userId,
            platformId,
            status: UserStatus.INACTIVE,
        })
    },
})

type ScimUserUpdate = {
    id: string
    platformId: string
    status?: UserStatus
    platformRole?: PlatformRole
    externalId?: string
}

// PUT/PATCH can set a user's externalId to one already owned by a DIFFERENT user of the
// same platform (IdPs move/rename external ids). The unique index
// idx_user_platform_id_external_id then turned the update into a raw 23505 -> HTTP 500.
// Check the natural key up front so the common case gets an immediate 409, still
// excluding the user itself (a no-op rewrite of its own externalId must pass).
async function assertExternalIdIsAvailable(params: {
    log: FastifyBaseLogger
    platformId: string
    userId: string
    externalId: string | undefined
}): Promise<void> {
    const { log, platformId, userId, externalId } = params
    if (isNil(externalId)) {
        return
    }
    const existingUser = await userService(log).getByPlatformAndExternalId({
        platformId,
        externalId,
    })
    if (!isNil(existingUser) && existingUser.id !== userId) {
        throw new ScimError(
            StatusCodes.CONFLICT,
            'User with external ID already exists',
        )
    }
}

// The pre-check above still leaves a check-then-act window (another admin path can
// commit the same externalId in between); the unique index is the real boundary, so
// map its violation to the same SCIM 409 instead of a raw driver error.
async function updateUserGuardingExternalIdConflict(params: {
    log: FastifyBaseLogger
    update: ScimUserUpdate
}): Promise<void> {
    const { log, update } = params
    try {
        await userService(log).update(update)
    }
    catch (error) {
        if (isUniqueViolation(error)) {
            throw new ScimError(
                StatusCodes.CONFLICT,
                'User with external ID already exists',
            )
        }
        throw error
    }
}

function toScimUserResource(
    user: Pick<User, 'id' | 'externalId' | 'created' | 'updated' | 'status' | 'platformRole'>,
    email: string,
    firstName: string,
    lastName: string,
): ScimUserResource {
    return {
        schemas: [SCIM_USER_SCHEMA],
        id: user.id,
        externalId: user.externalId ?? undefined,
        userName: email,
        name: {
            givenName: firstName,
            familyName: lastName,
        },
        emails: [{
            value: email,
            primary: true,
        }],
        active: user.status === UserStatus.ACTIVE,
        [SCIM_CUSTOM_USER_ATTRIBUTES_SCHEMA]: {
            platformRole: user.platformRole,
        },
        meta: {
            resourceType: 'User',
            created: user.created,
            lastModified: user.updated,
            location: `/scim/v2/Users/${user.id}`,
        },
    }
}
