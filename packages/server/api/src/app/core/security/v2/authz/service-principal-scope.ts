import { ActivepiecesError, ErrorCode, isNil } from '@inboxfm-connect/core-utils'
import { Principal, PrincipalType } from '@inboxfm-connect/shared'
import { PlatformAuthorization } from '../../authorization/common'

/**
 * A Connect API key (`cak-`) authenticates as a SERVICE principal that carries the
 * single project it was minted for (`principal.projectId`). A platform-wide `sk-`
 * key is also a SERVICE principal, but carries no projectId.
 *
 * A PLATFORM-authorization route that names no project answers from the platform's
 * own data — the user directory, the platform record, the platform-wide webhook
 * list. There is no project permission that can express "this project may read the
 * whole platform", so a project-bound SERVICE principal has to be refused outright
 * instead of being waved through by the `principal.type === SERVICE` early returns
 * in the authorization helpers.
 *
 * Three surfaces are deliberately out of scope here:
 * - `adminOnly` routes are the platform-admin surface, enforced by
 *   `assertPlatformIsOwnedByCurrentPrincipal` in `authorize.ts`.
 * - routes that do declare a `projectResource` must authorize the project id they
 *   name, so they keep their own project-scope checks.
 * - routes that opt in with `allowProjectScopedServicePrincipals` answer from data
 *   already scoped to the caller's own principal (not platform tenant data), so a
 *   project-scoped key may keep calling them.
 */
export const assertProjectScopedServicePrincipalIsNotPlatformWide = (
    principal: Principal,
    authorization: PlatformAuthorization,
): void => {
    if (principal.type !== PrincipalType.SERVICE || isNil(principal.projectId)) {
        return
    }
    if (authorization.adminOnly || authorization.allowProjectScopedServicePrincipals || !isNil(authorization.projectResource)) {
        return
    }
    throw new ActivepiecesError({
        code: ErrorCode.AUTHORIZATION,
        params: {
            message: 'This API key is scoped to a single project and cannot access platform-wide resources',
            projectId: principal.projectId,
        },
    })
}
