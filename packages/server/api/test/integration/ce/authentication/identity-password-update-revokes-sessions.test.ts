import { ErrorCode, PrincipalType, UserIdentityProvider } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accessTokenManager } from '../../../../src/app/authentication/lib/access-token-manager'
import { userIdentityService } from '../../../../src/app/authentication/user-identity/user-identity-service'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment({ fresh: true })
})

afterAll(async () => {
    await teardownTestEnvironment()
})

describe('Identity password updates must revoke existing sessions', () => {
    // Every path that sets a new password must rotate the identity tokenVersion:
    // the tokenVersion is the ONLY revocation axis for the stateless session
    // JWTs (verifyPrincipal compares it on every request). updatePassword()
    // rotates; update() accepted a password param without rotating, so a
    // session minted before the change kept working after it.
    it('rotates tokenVersion and rejects the pre-change token when update() sets a password', async () => {
        const log = app!.log
        const identity = await userIdentityService(log).create({
            email: 'revocation-invariant@example.com',
            password: 'original-password',
            firstName: 'First',
            lastName: 'Last',
            trackEvents: false,
            newsLetter: false,
            provider: UserIdentityProvider.EMAIL,
            verified: true,
        })

        const tokenBeforeChange = await accessTokenManager(log).generateToken({
            id: identity.id,
            type: PrincipalType.ONBOARDING,
            tokenVersion: identity.tokenVersion,
        })

        // The pre-change token is valid.
        const before = await accessTokenManager(log).verifyPrincipal(tokenBeforeChange)
        expect(before.id).toBe(identity.id)

        await userIdentityService(log).update(identity.id, { password: 'rotated-password' })

        // The stored tokenVersion must have changed...
        const afterUpdate = await userIdentityService(log).getOneOrFail({ id: identity.id })
        expect(afterUpdate.tokenVersion).not.toBe(identity.tokenVersion)

        // ...and the pre-change session must be dead, exactly like the
        // updatePassword() path.
        await expect(accessTokenManager(log).verifyPrincipal(tokenBeforeChange)).rejects.toMatchObject({
            error: {
                code: ErrorCode.SESSION_EXPIRED,
            },
        })

        // The new password verifies and the old one no longer does.
        const identityAfter = await userIdentityService(log).verifyIdentityPassword({
            email: 'revocation-invariant@example.com',
            password: 'rotated-password',
        })
        expect(identityAfter.id).toBe(identity.id)
        await expect(userIdentityService(log).verifyIdentityPassword({
            email: 'revocation-invariant@example.com',
            password: 'original-password',
        })).rejects.toMatchObject({
            error: {
                code: ErrorCode.INVALID_CREDENTIALS,
            },
        })
    })

    it('does not rotate tokenVersion for profile-only updates (no session churn)', async () => {
        const log = app!.log
        const identity = await userIdentityService(log).create({
            email: 'profile-only-update@example.com',
            password: 'password-stays',
            firstName: 'First',
            lastName: 'Last',
            trackEvents: false,
            newsLetter: false,
            provider: UserIdentityProvider.EMAIL,
            verified: true,
        })

        await userIdentityService(log).update(identity.id, { firstName: 'Renamed' })

        const afterUpdate = await userIdentityService(log).getOneOrFail({ id: identity.id })
        expect(afterUpdate.tokenVersion).toBe(identity.tokenVersion)
        expect(afterUpdate.firstName).toBe('Renamed')
    })
})
