import { apId } from '@inboxfm-connect/core-utils'
import { OtpType, UserStatus } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { db } from '../../../helpers/db'
import { mockBasicUser } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

// A user who never requested a code has NO otp row (CE/EE sign-up
// auto-verifies, so the row is never created; a cloud user who never hit the
// resend endpoint has none either). Confirming must fail-closed with the
// INVALID_OTP contract — a missing row is not a server error, and a 500 on a
// public endpoint both pollutes error tracking and diverges from the
// wrong-code/expired-code behavior asserted in enterprise-local-authn.test.ts.
describe('Enterprise Local Authn API — missing OTP row', () => {
    it('verify-email returns INVALID_OTP (not a 500) when no OTP was ever issued', async () => {
        const { mockUserIdentity } = await mockBasicUser({
            user: {
                status: UserStatus.ACTIVE,
            },
            userIdentity: {
                verified: false,
            },
        })

        const response = await app?.inject({
            method: 'POST',
            url: '/api/v1/authn/local/verify-email',
            body: {
                identityId: mockUserIdentity.id,
                otp: '123456',
            },
        })

        expect(response?.statusCode).toBe(StatusCodes.GONE)
        expect(response?.json().code).toBe('INVALID_OTP')

        const userIdentity = await db.findOneBy('user_identity', { id: mockUserIdentity.id })
        expect(userIdentity?.verified).toBe(false)
    })

    it('reset-password returns INVALID_OTP (not a 500) when no OTP was ever issued', async () => {
        const { mockUserIdentity } = await mockBasicUser({
            user: {
                status: UserStatus.ACTIVE,
            },
            userIdentity: {
                verified: true,
            },
        })

        const response = await app?.inject({
            method: 'POST',
            url: '/api/v1/authn/local/reset-password',
            body: {
                identityId: mockUserIdentity.id,
                otp: '123456',
                newPassword: 'new-password-123',
            },
        })

        expect(response?.statusCode).toBe(StatusCodes.GONE)
        expect(response?.json().code).toBe('INVALID_OTP')
    })

    it('an identity that never existed also gets INVALID_OTP, not a 500', async () => {
        const response = await app?.inject({
            method: 'POST',
            url: '/api/v1/authn/local/verify-email',
            body: {
                identityId: apId(),
                otp: '123456',
            },
        })

        expect(response?.statusCode).toBe(StatusCodes.GONE)
        expect(response?.json().code).toBe('INVALID_OTP')
    })
})
