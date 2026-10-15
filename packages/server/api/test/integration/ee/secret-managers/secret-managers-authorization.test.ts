import { ErrorCode } from '@inboxfm-connect/core-utils'
import { PlatformRole, PrincipalType, SecretManagerConnectionScope, SecretManagerProviderId } from '@inboxfm-connect/shared'
import { FastifyInstance } from 'fastify'
import { StatusCodes } from 'http-status-codes'
import { generateMockToken } from '../../../helpers/auth'
import { db } from '../../../helpers/db'
import { mockAndSaveBasicSetup, mockBasicUser } from '../../../helpers/mocks'
import { setupTestEnvironment, teardownTestEnvironment } from '../../../helpers/test-setup'

let app: FastifyInstance | null = null

beforeAll(async () => {
    app = await setupTestEnvironment()
})

afterAll(async () => {
    await teardownTestEnvironment()
})

async function seedSecretManager(platformId: string, projectId: string | null): Promise<string> {
    const id = await import('@inboxfm-connect/core-utils').then(m => m.apId())
    await db.save('secret_manager_connection', {
        id,
        platformId,
        providerId: SecretManagerProviderId.HASHICORP,
        name: `vault-${id}`,
        scope: projectId ? SecretManagerConnectionScope.PROJECT : SecretManagerConnectionScope.PLATFORM,
        projectIds: projectId ? [projectId] : null,
        auth: null,
    })
    return id
}

/**
 * Secret-manager rows describe which external secret stores a tenant wired up
 * (provider, name, scope, target projects, connection status). Listing them is
 * the platform-admin settings console — every sibling route on this controller
 * is platformAdminOnly, so a mere platform member must not be able to
 * enumerate them, with or without a client-supplied projectId.
 */
describe('Secret Managers API — list authorization', () => {
    it('rejects a non-admin platform member listing secret managers', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup({
            plan: { secretManagersEnabled: true },
        })
        await seedSecretManager(mockPlatform.id, null)
        await seedSecretManager(mockPlatform.id, mockProject.id)

        const { mockUser: attacker } = await mockBasicUser({
            user: {
                platformId: mockPlatform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const attackerToken = await generateMockToken({
            id: attacker.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/secret-managers',
            headers: { authorization: `Bearer ${attackerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response?.json<{ code?: string }>()?.code).toBe(ErrorCode.AUTHORIZATION)
    })

    it('rejects a non-admin platform member naming another project via ?projectId', async () => {
        const { mockPlatform, mockProject } = await mockAndSaveBasicSetup({
            plan: { secretManagersEnabled: true },
        })
        await seedSecretManager(mockPlatform.id, mockProject.id)

        const { mockUser: attacker } = await mockBasicUser({
            user: {
                platformId: mockPlatform.id,
                platformRole: PlatformRole.MEMBER,
            },
        })
        const attackerToken = await generateMockToken({
            id: attacker.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/secret-managers',
            query: { projectId: mockProject.id },
            headers: { authorization: `Bearer ${attackerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.FORBIDDEN)
        expect(response?.json<{ code?: string }>()?.code).toBe(ErrorCode.AUTHORIZATION)
    })

    it('still lets the platform admin list secret managers', async () => {
        const { mockPlatform, mockProject, mockOwner } = await mockAndSaveBasicSetup({
            plan: { secretManagersEnabled: true },
        })
        await seedSecretManager(mockPlatform.id, mockProject.id)

        const ownerToken = await generateMockToken({
            id: mockOwner.id,
            type: PrincipalType.USER,
            platform: { id: mockPlatform.id },
        })

        const response = await app?.inject({
            method: 'GET',
            url: '/api/v1/secret-managers',
            query: { projectId: mockProject.id },
            headers: { authorization: `Bearer ${ownerToken}` },
        })

        expect(response?.statusCode).toBe(StatusCodes.OK)
        const body = response?.json<{ data: Array<{ name: string }> }>()
        expect(body?.data?.length).toBe(1)
    })
})
