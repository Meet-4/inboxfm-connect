import { ActivepiecesError, ErrorCode, isNil, Permission } from '@inboxfm-connect/core-utils'
import { ApEdition, PlatformRole, Principal, PrincipalType, UserIdentityProvider } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { userIdentityService } from '../../../../authentication/user-identity/user-identity-service'
import { rbacService } from '../../../../ee/authentication/project-role/rbac-service'
import { projectMemberService } from '../../../../ee/projects/project-members/project-member.service'
import { system } from '../../../../helper/system/system'
import { userService } from '../../../../user/user-service'
import { AuthorizationRouteSecurity, ProjectAuthorizationConfig } from '../../authorization/authorization'
import { AuthorizationType, RouteKind } from '../../authorization/common'
import { communityProjectAccess } from './project-access'

export const authorizeOrThrow = async (principal: Principal, security: AuthorizationRouteSecurity, log: FastifyBaseLogger): Promise<void> => {
    if (security.kind === RouteKind.PUBLIC) {
        return
    }
    switch (security.authorization.type) {
        case AuthorizationType.PROJECT:
            await assertPrinicpalIsOneOf(security.authorization.allowedPrincipals, principal.type)
            await assertAccessToProject(principal, security.authorization, log)
            break
        case AuthorizationType.PLATFORM:
            await assertPrinicpalIsOneOf(security.authorization.allowedPrincipals, principal.type)
            if (security.authorization.adminOnly) {
                await assertPlatformIsOwnedByCurrentPrincipal(principal, log)
            }
            if (security.authorization.nonEmbedUsersOnly) {
                await assertNonEmbedOrAdmin(principal, log)
            }
            break
        case AuthorizationType.UNSCOPED:
            await assertPrinicpalIsOneOf(security.authorization.allowedPrincipals, principal.type)
            break
        case AuthorizationType.NONE:
            break
    }
}


async function assertNonEmbedOrAdmin(principal: Principal, log: FastifyBaseLogger): Promise<void> {
    if (principal.type === PrincipalType.SERVICE) {
        return
    }
    const user = await userService(log).getOneOrFail({ id: principal.id })
    if (user.platformRole === PlatformRole.ADMIN) {
        return
    }
    const identity = await userIdentityService(log).getOneOrFail({ id: user.identityId })
    if (identity.provider === UserIdentityProvider.JWT) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Embed users are not allowed to access this resource.',
            },
        })
    }
    if (isNil(user.platformId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'User is not associated with a platform.',
            },
        })
    }
    const hasInvitePermission = system.getEdition() === ApEdition.COMMUNITY
        ? await communityProjectAccess.hasPermissionOnAnyProject()
        : await projectMemberService(log).hasPermissionOnAnyProject({
            userId: user.id,
            platformId: user.platformId,
            permission: Permission.WRITE_INVITATION,
        })
    if (!hasInvitePermission) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'User does not have invite permission on any project.',
            },
        })
    }
}

async function assertPlatformIsOwnedByCurrentPrincipal(principal: Principal, log: FastifyBaseLogger): Promise<void> {
    if (principal.type === PrincipalType.SERVICE) {
        // Only a platform-wide API key may stand in for the platform owner here. A
        // Connect API key (`cak-`) is minted by a project admin and authenticates as a
        // SERVICE principal carrying `projectId` (see authenticate.ts); treating it like
        // the platform's own `sk-` credential let any project admin mint a key and then
        // rewrite platform-level resources — event destinations, global connections,
        // platform roles, projects — with it.
        assertServicePrincipalIsNotProjectScoped(principal)
        return
    }
    const user = await userService(log).getOneOrFail({ id: principal.id })
    if (user.platformRole !== PlatformRole.ADMIN) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'User is not an admin/owner of the platform.',
            },
        })
    }
}

// The companion of `assertServicePrincipalScope` below: that one pins a project-bound
// SERVICE principal to its own project for PROJECT-scoped routes, this one keeps it out
// of PLATFORM-scoped routes, where a project binding has no meaning and the only
// legitimate SERVICE caller is a platform-wide key.
function assertServicePrincipalIsNotProjectScoped(principal: Principal): void {
    if (principal.type !== PrincipalType.SERVICE || isNil(principal.projectId)) {
        return
    }
    throw new ActivepiecesError({
        code: ErrorCode.AUTHORIZATION,
        params: {
            message: 'This API key is scoped to a single project and cannot access platform-level resources',
            projectId: principal.projectId,
        },
    })
}


async function assertAccessToProject(principal: Principal, projectSecurity: ProjectAuthorizationConfig, log: FastifyBaseLogger): Promise<void> {
    if (isNil(projectSecurity.projectId)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'Project ID is required',
            },
        })
    }
    assertServicePrincipalScope(principal, projectSecurity.projectId)
    if (system.getEdition() === ApEdition.COMMUNITY) {
        await communityProjectAccess.assertPrincipalAccessToProject({ principal, permission: projectSecurity.permission, projectId: projectSecurity.projectId, log })
        return
    }
    await rbacService(log).assertPrinicpalAccessToProject({ principal, permission: projectSecurity.permission, projectId: projectSecurity.projectId })
}

// Original, non-ee enforcement for project-scoped Connect API keys (see
// connect-api-key.service.ts): a SERVICE principal minted with a bound projectId
// may only ever touch that one project, regardless of what the ee rbac check below
// allows for platform-wide keys.
function assertServicePrincipalScope(principal: Principal, projectId: string): void {
    if (principal.type !== PrincipalType.SERVICE || isNil(principal.projectId)) {
        return
    }
    if (principal.projectId !== projectId) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'This API key is scoped to a different project',
                projectId,
            },
        })
    }
}


async function assertPrinicpalIsOneOf< T extends readonly PrincipalType[]>(allowedPrincipals: T, currentPrincipal: PrincipalType): Promise<void> {
    if (!allowedPrincipals.includes(currentPrincipal)) {
        throw new ActivepiecesError({
            code: ErrorCode.AUTHORIZATION,
            params: {
                message: 'principal is not allowed for this route',
            },
        })
    }
}