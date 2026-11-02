import { apId } from '@inboxfm-connect/core-utils'
import { ErrorCode } from '@inboxfm-connect/core-utils'
import { ProjectType, TeamProjectsLimit } from '@inboxfm-connect/shared'
import { faker } from '@faker-js/faker'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { databaseConnection } from '../../../../src/app/database/database-connection'
import {
    createMockApiKey,
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

// The platform-project REST surface enforces plan.teamProjectsLimit on every
// team-project create (assertMaximumNumberOfProjectsReachedByEdition). The SCIM
// Groups endpoint creates TEAM projects too, so the same plan limit must hold
// there — otherwise an IdP (or anything holding the platform API key) can
// provision unlimited team projects on a plan priced for one.
async function setupLimitedScimPlatform(teamProjectsLimit: TeamProjectsLimit) {
    const { mockPlatform } = await mockAndSaveBasicSetup({
        plan: {
            scimEnabled: true,
            projectRolesEnabled: true,
            teamProjectsLimit,
        },
        // The basic setup saves one project; keep it PERSONAL so it does not
        // consume the team-projects quota before the test starts.
        project: {
            type: ProjectType.PERSONAL,
        },
    })

    const mockApiKey = createMockApiKey({
        platformId: mockPlatform.id,
    })
    await databaseConnection().getRepository('api_key').save(mockApiKey)

    return {
        mockPlatform,
        bearerToken: `Bearer ${mockApiKey.value}`,
    }
}

function mockIdpGroup() {
    return {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        externalId: `idp-group-${apId()}`,
        displayName: faker.company.name(),
        members: [],
    }
}

describe('SCIM Groups team-projects quota', () => {
    it('rejects the second team project on a plan limited to one team project', async () => {
        const { bearerToken, mockPlatform } = await setupLimitedScimPlatform(TeamProjectsLimit.ONE)

        const firstResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/scim/v2/Groups',
            headers: { authorization: bearerToken },
            body: mockIdpGroup(),
        })
        expect(firstResponse?.statusCode).toBe(StatusCodes.CREATED)

        const secondResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/scim/v2/Groups',
            headers: { authorization: bearerToken },
            body: mockIdpGroup(),
        })

        expect(secondResponse?.statusCode).toBe(StatusCodes.PAYMENT_REQUIRED)
        expect(secondResponse?.json().code).toBe(ErrorCode.FEATURE_DISABLED)

        // Only one team project may exist on the platform.
        const teamProjectsCount = await databaseConnection()
            .getRepository('project')
            .countBy({ platformId: mockPlatform.id, type: ProjectType.TEAM })
        expect(teamProjectsCount).toBe(1)
    })

    it('allows repeated creates on a plan with unlimited team projects', async () => {
        const { bearerToken } = await setupLimitedScimPlatform(TeamProjectsLimit.UNLIMITED)

        const firstResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/scim/v2/Groups',
            headers: { authorization: bearerToken },
            body: mockIdpGroup(),
        })
        expect(firstResponse?.statusCode).toBe(StatusCodes.CREATED)

        const secondResponse = await app?.inject({
            method: 'POST',
            url: '/api/v1/scim/v2/Groups',
            headers: { authorization: bearerToken },
            body: mockIdpGroup(),
        })
        expect(secondResponse?.statusCode).toBe(StatusCodes.CREATED)
    })
})
