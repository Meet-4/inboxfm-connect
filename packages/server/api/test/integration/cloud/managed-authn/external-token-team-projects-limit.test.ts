import { ErrorCode } from '@inboxfm-connect/core-utils'
import { ProjectType, TeamProjectsLimit } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { generateMockExternalToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import {
    createMockSigningKey,
    mockAndSaveBasicSetup,
} from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

// managed-authn JIT-provisions a TEAM project per distinct externalProjectId on
// every external-token sign-in. The REST surface enforces
// plan.teamProjectsLimit on team-project creates, so the JIT path must enforce
// the same limit when it would create a NEW project — otherwise a platform
// admin on a one-team-project plan mints unlimited team projects by issuing
// external tokens with arbitrary externalProjectIds.
async function setupLimitedPlatform() {
    const { mockPlatform } = await mockAndSaveBasicSetup({
        plan: {
            teamProjectsLimit: TeamProjectsLimit.ONE,
        },
        // Keep the basic-setup project out of the team quota.
        project: {
            type: ProjectType.PERSONAL,
        },
    })

    const mockSigningKey = createMockSigningKey({
        platformId: mockPlatform.id,
    })
    await db.save('signing_key', mockSigningKey)

    return {
        mockPlatform,
        mockSigningKey,
    }
}

describe('Managed Authentication team-projects quota', () => {
    it('rejects a second JIT team project on a plan limited to one team project', async () => {
        const { mockPlatform, mockSigningKey } = await setupLimitedPlatform()

        const firstToken = generateMockExternalToken({
            platformId: mockPlatform.id,
            signingKeyId: mockSigningKey.id,
            externalProjectId: 'quota-project-1',
        })
        const firstResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/managed-authn/external-token',
            body: {
                externalAccessToken: firstToken.mockExternalToken,
            },
        })
        expect(firstResponse?.statusCode).toBe(StatusCodes.OK)
        expect(firstResponse?.json().projectId).toHaveLength(21)

        // A different externalProjectId would provision a SECOND team project.
        const secondToken = generateMockExternalToken({
            platformId: mockPlatform.id,
            signingKeyId: mockSigningKey.id,
            externalProjectId: 'quota-project-2',
        })
        const secondResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/managed-authn/external-token',
            body: {
                externalAccessToken: secondToken.mockExternalToken,
            },
        })
        expect(secondResponse?.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)
        expect(secondResponse?.json().code).toBe(ErrorCode.FEATURE_DISABLED)
    })

    it('keeps idempotent re-entry into the same external project working under the quota', async () => {
        const { mockPlatform, mockSigningKey } = await setupLimitedPlatform()

        const firstToken = generateMockExternalToken({
            platformId: mockPlatform.id,
            signingKeyId: mockSigningKey.id,
            externalProjectId: 'quota-project-1',
        })
        const firstResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/managed-authn/external-token',
            body: {
                externalAccessToken: firstToken.mockExternalToken,
            },
        })
        expect(firstResponse?.statusCode).toBe(StatusCodes.OK)

        // Same externalProjectId again: re-entry must NOT be blocked by the
        // quota — it resolves to the existing project.
        const repeatToken = generateMockExternalToken({
            platformId: mockPlatform.id,
            signingKeyId: mockSigningKey.id,
            externalProjectId: 'quota-project-1',
        })
        const repeatResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/managed-authn/external-token',
            body: {
                externalAccessToken: repeatToken.mockExternalToken,
            },
        })
        expect(repeatResponse?.statusCode).toBe(StatusCodes.OK)
        expect(repeatResponse?.json().projectId).toBe(firstResponse?.json().projectId)
    })
})
