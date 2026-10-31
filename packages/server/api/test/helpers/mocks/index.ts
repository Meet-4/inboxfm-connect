import { faker } from '@faker-js/faker'
import { AIProviderName, apId, assertNotNullOrUndefined, ProjectRole, RoleType } from '@inboxfm-connect/core-utils'
import { LATEST_CONTEXT_VERSION, PieceMetadata } from '@inboxfm-connect/pieces-framework'
import { apDayjs } from '@inboxfm-connect/server-utils'
import { AiCreditsAutoTopUpState, AIProvider, ApiKey, AppConnection, AppConnectionScope, AppConnectionStatus, AppConnectionType, ApplicationEvent, ApplicationEventName, Cell, ColorName, ConnectApiKey, EventDestinationScope, Field, FieldType, File, FileCompression, FileLocation, FileType, FilteredPieceBehavior, InvitationStatus, InvitationType, KeyAlgorithm, OAuthApp, OtpModel, OtpState, OtpType, PackageType, PiecesFilterType, PieceType, Platform, PlatformPlan, PlatformRole, Project, ProjectIcon, ProjectMember, ProjectPlan, ProjectType, Record, SigningKey, Table, TeamProjectsLimit, User, UserIdentity, UserIdentityProvider, UserInvitation, UserStatus } from '@inboxfm-connect/shared'
import bcrypt from 'bcrypt'
import dayjs from 'dayjs'
import { FastifyBaseLogger } from 'fastify'
import { AIProviderSchema } from '../../../src/app/ai/ai-provider-entity'
import { generateConnectApiKey } from '../../../src/app/connect-api-keys/connect-api-key.service'
import { databaseConnection } from '../../../src/app/database/database-connection'
import { generateApiKey } from '../../../src/app/ee/api-keys/api-key-service'
import { OAuthAppWithEncryptedSecret } from '../../../src/app/ee/oauth-apps/oauth-app.entity'
import { PlatformPlanEntity } from '../../../src/app/ee/platform/platform-plan/platform-plan.entity'
import { encryptUtils } from '../../../src/app/helper/encryption'
import { PieceMetadataSchema } from '../../../src/app/pieces/metadata/piece-metadata-entity'
import { pieceMetadataService } from '../../../src/app/pieces/metadata/piece-metadata-service'
import { PieceTagSchema } from '../../../src/app/pieces/tags/pieces/piece-tag.entity'
import { TagEntitySchema } from '../../../src/app/pieces/tags/tag-entity'

export const CLOUD_PLATFORM_ID = 'cloud-id'

export const createMockUserIdentity = (userIdentity?: Partial<UserIdentity>): UserIdentity => {
    return {
        id: userIdentity?.id ?? apId(),
        created: userIdentity?.created ?? faker.date.recent().toISOString(),
        updated: userIdentity?.updated ?? faker.date.recent().toISOString(),
        email: (userIdentity?.email ?? faker.internet.email()).toLowerCase().trim(),
        firstName: userIdentity?.firstName ?? faker.person.firstName(),
        lastName: userIdentity?.lastName ?? faker.person.lastName(),
        tokenVersion: userIdentity?.tokenVersion ?? undefined,
        password: userIdentity?.password
            ? bcrypt.hashSync(userIdentity.password, 10)
            : faker.internet.password(),
        trackEvents: userIdentity?.trackEvents ?? faker.datatype.boolean(),
        newsLetter: userIdentity?.newsLetter ?? faker.datatype.boolean(),
        verified: userIdentity?.verified ?? faker.datatype.boolean(),
        provider: userIdentity?.provider ?? UserIdentityProvider.EMAIL,
    }
}

export const createMockUser = (user?: Partial<User>): User => {
    return {
        id: user?.id ?? apId(),
        created: user?.created ?? faker.date.recent().toISOString(),
        updated: user?.updated ?? faker.date.recent().toISOString(),
        status: user?.status ?? UserStatus.ACTIVE,
        platformRole: user?.platformRole ?? faker.helpers.enumValue(PlatformRole),
        externalId: user?.externalId,
        identityId: user?.identityId ?? apId(),
        platformId: user?.platformId ?? null,
    }
}

export const createMockOAuthApp = async (
    oAuthApp?: Partial<OAuthApp>,
): Promise<OAuthAppWithEncryptedSecret> => {
    return {
        id: oAuthApp?.id ?? apId(),
        created: oAuthApp?.created ?? faker.date.recent().toISOString(),
        updated: oAuthApp?.updated ?? faker.date.recent().toISOString(),
        platformId: oAuthApp?.platformId ?? apId(),
        pieceName: oAuthApp?.pieceName ?? faker.lorem.word(),
        clientId: oAuthApp?.clientId ?? apId(),
        clientSecret: await encryptUtils.encryptString(faker.lorem.word()),
    }
}

export const createMockPlan = (plan?: Partial<ProjectPlan>): ProjectPlan => {
    return {
        id: plan?.id ?? apId(),
        created: plan?.created ?? faker.date.recent().toISOString(),
        updated: plan?.updated ?? faker.date.recent().toISOString(),
        projectId: plan?.projectId ?? apId(),
        name: plan?.name ?? faker.lorem.word(),
        locked: plan?.locked ?? false,
        pieces: plan?.pieces ?? [],
        piecesFilterType: plan?.piecesFilterType ?? PiecesFilterType.NONE,
    }
}

export const createMockUserInvitation = (userInvitation: Partial<UserInvitation>): UserInvitation => {
    return {
        id: userInvitation.id ?? apId(),
        created: userInvitation.created ?? faker.date.recent().toISOString(),
        updated: userInvitation.updated ?? faker.date.recent().toISOString(),
        email: userInvitation.email ?? faker.internet.email(),
        type: userInvitation.type ?? faker.helpers.enumValue(InvitationType),
        platformId: userInvitation.platformId ?? apId(),
        projectId: userInvitation.projectId,
        projectRole: userInvitation.projectRole,
        platformRole: userInvitation.platformRole,
        status: userInvitation.status ?? faker.helpers.enumValue(InvitationStatus),
    }
}

export const createMockProject = (project?: Partial<Project>): Project => {
    const icon: ProjectIcon = {
        color: faker.helpers.enumValue(ColorName),
    }
    return {
        id: project?.id ?? apId(),
        created: project?.created ?? faker.date.recent().toISOString(),
        updated: project?.updated ?? faker.date.recent().toISOString(),
        deleted: project?.deleted ?? null,
        ownerId: project?.ownerId ?? apId(),
        displayName: project?.displayName ?? faker.lorem.word(),
        platformId: project?.platformId ?? apId(),
        externalId: project?.externalId ?? apId(),
        releasesEnabled: project?.releasesEnabled ?? false,
        metadata: project?.metadata ?? null,
        type: project?.type ?? ProjectType.TEAM,
        poolId: project?.poolId ?? null,
        workerGroupId: project?.workerGroupId ?? null,
        icon,
    }
}

export const createMockPlatformPlan = (platformPlan?: Partial<PlatformPlan>): PlatformPlan => {
    return {
        id: platformPlan?.id ?? apId(),
        created: platformPlan?.created ?? faker.date.recent().toISOString(),
        updated: platformPlan?.updated ?? faker.date.recent().toISOString(),
        platformId: platformPlan?.platformId ?? apId(),
        tablesEnabled: platformPlan?.tablesEnabled ?? false,
        includedAiCredits: platformPlan?.includedAiCredits ?? 0,
        licenseKey: platformPlan?.licenseKey ?? faker.lorem.word(),
        stripeCustomerId: undefined,
        stripeSubscriptionId: undefined,
        ssoEnabled: platformPlan?.ssoEnabled ?? false,
        eventStreamingEnabled: platformPlan?.eventStreamingEnabled ?? false,
        aiCreditsAutoTopUpState: AiCreditsAutoTopUpState.DISABLED,
        environmentsEnabled: platformPlan?.environmentsEnabled ?? false,
        analyticsEnabled: platformPlan?.analyticsEnabled ?? false,
        auditLogEnabled: platformPlan?.auditLogEnabled ?? false,
        globalConnectionsEnabled: platformPlan?.globalConnectionsEnabled ?? false,
        customRolesEnabled: platformPlan?.customRolesEnabled ?? false,
        managePiecesEnabled: platformPlan?.managePiecesEnabled ?? false,
        manageTemplatesEnabled: platformPlan?.manageTemplatesEnabled ?? false,
        customAppearanceEnabled: platformPlan?.customAppearanceEnabled ?? false,
        apiKeysEnabled: platformPlan?.apiKeysEnabled ?? false,
        stripeSubscriptionStatus: undefined,
        showPoweredBy: platformPlan?.showPoweredBy ?? false,
        embeddingEnabled: platformPlan?.embeddingEnabled ?? false,
        agentsEnabled: platformPlan?.agentsEnabled ?? false,
        aiProvidersEnabled: platformPlan?.aiProvidersEnabled ?? false,
        chatEnabled: platformPlan?.chatEnabled ?? false,
        workerGroupsEnabled: platformPlan?.workerGroupsEnabled ?? false,
        teamProjectsLimit: platformPlan?.teamProjectsLimit ?? TeamProjectsLimit.NONE,
        projectRolesEnabled: platformPlan?.projectRolesEnabled ?? false,
        stripeSubscriptionEndDate: apDayjs().endOf('month').unix(),
        stripeSubscriptionStartDate: apDayjs().startOf('month').unix(),
        plan: platformPlan?.plan,
        secretManagersEnabled: platformPlan?.secretManagersEnabled ?? false,
        scimEnabled: platformPlan?.scimEnabled ?? false,
        canary: platformPlan?.canary ?? false,
        customDomainsEnabled: false,
    }
}
export const createMockPlatform = (platform?: Partial<Platform>): Platform => {
    return {
        id: platform?.id ?? apId(),
        created: platform?.created ?? faker.date.recent().toISOString(),
        updated: platform?.updated ?? faker.date.recent().toISOString(),
        ownerId: platform?.ownerId ?? apId(),
        enforceAllowedAuthDomains: platform?.enforceAllowedAuthDomains ?? false,
        federatedAuthProviders: platform?.federatedAuthProviders ?? { saml: null },
        allowedAuthDomains: platform?.allowedAuthDomains ?? [],
        allowedEmbedOrigins: platform?.allowedEmbedOrigins ?? [],
        name: platform?.name ?? faker.lorem.word(),
        primaryColor: platform?.primaryColor ?? faker.color.rgb(),
        themeColors: platform?.themeColors ?? null,
        logoIconUrl: platform?.logoIconUrl ?? faker.image.urlPlaceholder(),
        fullLogoUrl: platform?.fullLogoUrl ?? faker.image.urlPlaceholder(),
        emailAuthEnabled: platform?.emailAuthEnabled ?? faker.datatype.boolean(),
        pinnedPieces: platform?.pinnedPieces ?? [],
        favIconUrl: platform?.favIconUrl ?? faker.image.urlPlaceholder(),
        filteredPieceNames: platform?.filteredPieceNames ?? [],
        filteredPieceBehavior:
            platform?.filteredPieceBehavior ??
            faker.helpers.enumValue(FilteredPieceBehavior),
        cloudAuthEnabled: platform?.cloudAuthEnabled ?? faker.datatype.boolean(),
        googleAuthEnabled: platform?.googleAuthEnabled ?? true,
        ssoDomain: platform?.ssoDomain ?? null,
        ssoDomainVerification: platform?.ssoDomainVerification ?? null,
    }
}

export const createMockPlatformWithOwner = (
    params?: CreateMockPlatformWithOwnerParams,
): CreateMockPlatformWithOwnerReturn => {
    const mockOwnerId = params?.owner?.id ?? apId()
    const mockPlatformId = params?.platform?.id ?? apId()

    const mockUserIdentity = createMockUserIdentity({})

    const mockOwner = createMockUser({
        identityId: mockUserIdentity.id,
        ...params?.owner,
        id: mockOwnerId,
        platformId: mockPlatformId,
        platformRole: PlatformRole.ADMIN,
    })

    const mockPlatform = createMockPlatform({
        ...params?.platform,
        id: mockPlatformId,
        ownerId: mockOwnerId,
    })

    return {
        mockUserIdentity,
        mockPlatform,
        mockOwner,
    }
}

export const createMockProjectMember = (
    projectMember?: Omit<Partial<ProjectMember>, 'projectRoleId'> & {
        projectRoleId: string
    },
): ProjectMember => {
    assertNotNullOrUndefined(projectMember?.userId, 'userId')
    return {
        id: projectMember?.id ?? apId(),
        created: projectMember?.created ?? faker.date.recent().toISOString(),
        updated: projectMember?.updated ?? faker.date.recent().toISOString(),
        platformId: projectMember?.platformId ?? apId(),
        projectRoleId: projectMember.projectRoleId,
        userId: projectMember?.userId,
        projectId: projectMember?.projectId ?? apId(),
    }
}

const MOCK_SIGNING_KEY_PUBLIC_KEY = `-----BEGIN RSA PUBLIC KEY-----
MIICCgKCAgEAlnd5vGP/1bzcndN/yRD+ZTd6tuemxaJd+12bOZ2QCXcTM03AKSp3
NE5QMyIi13PXMg+z1uPowfivPJ4iVTMaW1U00O7JlUduGR0VrG0BCJlfEf852V71
TfE+2+EpMme9Yw6Gs/YAuOwgVwu3n/XF0il3FTIm1oY1a/MA79rv0RSscnIgCaYJ
e86LWm+H6753Si0MIId/ajIfYYIndN6qRIlPsgagdL+kljUSPEiIzmV0POxTltBo
tXL1t7Mu+meJrY85MXG5W8BS05+q6dJql7Cl0UbPK152ziakB+biMI/4hYlaOIBT
3KeOcz/Jg7Zv21Y0tbdrZ5osVrrNpFsCV7PGyQIUDVmmnCHrOEBS2XM5zOHzTxMl
JQh3Db318rB5415zuBTzrO+20++03kH4SwZEEBg1SDAInYwLOWldbTuZuD0Hx7P2
g4a3OqHHVOcAgtsHgmU7/zCgCIETg4KbRdpSsqOm/YJDWWoLDTwvKnH5QHSBacq1
kxbNAUSuLQESkfZq1Dw5+tdBDJr29bxjmiSggyittTYn1B3iHACNoe4zj9sMQQIf
j9mmntXsa/leIwBVspiEOHYZwJOe5+goSd8K1VIQJxC1DVBxB2eHxMvuo3eyJ0HE
DlebIeZy4zrE1LPgRic1kfdemyxvuN3iwZnPGiY79nL1ZNDM3M4ApSMCAwEAAQ==
-----END RSA PUBLIC KEY-----`

export const createMockApiKey = (
    apiKey?: Partial<Omit<ApiKey, 'hashedValue' | 'truncatedValue'>>,
): ApiKey & { value: string } => {
    const { secretHashed, secretTruncated, secret } = generateApiKey()
    return {
        id: apiKey?.id ?? apId(),
        created: apiKey?.created ?? faker.date.recent().toISOString(),
        updated: apiKey?.updated ?? faker.date.recent().toISOString(),
        displayName: apiKey?.displayName ?? faker.lorem.word(),
        platformId: apiKey?.platformId ?? apId(),
        hashedValue: secretHashed,
        value: secret,
        truncatedValue: secretTruncated,
        lastUsedAt: apiKey?.lastUsedAt ?? null,
        expiresAt: apiKey?.expiresAt ?? null,
    }
}

export const createMockConnectApiKey = (
    connectApiKey?: Partial<Omit<ConnectApiKey, 'hashedValue' | 'truncatedValue'>>,
): ConnectApiKey & { value: string } => {
    const { hashed, truncated, raw } = generateConnectApiKey()
    return {
        id: connectApiKey?.id ?? apId(),
        created: connectApiKey?.created ?? faker.date.recent().toISOString(),
        updated: connectApiKey?.updated ?? faker.date.recent().toISOString(),
        displayName: connectApiKey?.displayName ?? faker.lorem.word(),
        platformId: connectApiKey?.platformId ?? apId(),
        projectId: connectApiKey?.projectId ?? apId(),
        hashedValue: hashed,
        value: raw,
        truncatedValue: truncated,
        lastUsedAt: connectApiKey?.lastUsedAt ?? null,
        expiresAt: connectApiKey?.expiresAt ?? null,
    }
}


export const createMockSigningKey = (
    signingKey?: Partial<SigningKey>,
): SigningKey => {
    return {
        id: signingKey?.id ?? apId(),
        created: signingKey?.created ?? faker.date.recent().toISOString(),
        updated: signingKey?.updated ?? faker.date.recent().toISOString(),
        displayName: signingKey?.displayName ?? faker.lorem.word(),
        platformId: signingKey?.platformId ?? apId(),
        publicKey: signingKey?.publicKey ?? MOCK_SIGNING_KEY_PUBLIC_KEY,
        algorithm: signingKey?.algorithm ?? KeyAlgorithm.RSA,
    }
}


export const createMockTag = (tag?: Partial<Omit<TagEntitySchema, 'platform'>>): Omit<TagEntitySchema, 'platform'> => {
    return {
        id: tag?.id ?? apId(),
        created: tag?.created ?? faker.date.recent().toISOString(),
        updated: tag?.updated ?? faker.date.recent().toISOString(),
        platformId: tag?.platformId ?? apId(),
        name: tag?.name ?? faker.lorem.word(),
    }
}


export const createMockPieceTag = (request: Partial<Omit<PieceTagSchema, 'platform' | 'tag'>>): Omit<PieceTagSchema, 'platform' | 'tag'> => {
    return {
        id: request.id ?? apId(),
        created: request.created ?? faker.date.recent().toISOString(),
        updated: request.updated ?? faker.date.recent().toISOString(),
        platformId: request.platformId ?? apId(),
        pieceName: request.pieceName ?? faker.lorem.word(),
        tagId: request.tagId ?? apId(),
    }
}

export const createMockPieceMetadata = (
    pieceMetadata?: Partial<Omit<PieceMetadataSchema, 'project'>>,
): Omit<PieceMetadataSchema, 'project'> => {
    return {
        id: pieceMetadata?.id ?? apId(),
        projectUsage: 0,
        created: pieceMetadata?.created ?? faker.date.recent().toISOString(),
        updated: pieceMetadata?.updated ?? faker.date.recent().toISOString(),
        name: pieceMetadata?.name ?? faker.lorem.word(),
        displayName: pieceMetadata?.displayName ?? faker.lorem.word(),
        logoUrl: pieceMetadata?.logoUrl ?? faker.image.urlPlaceholder(),
        description: pieceMetadata?.description ?? faker.lorem.sentence(),
        directoryPath: pieceMetadata?.directoryPath,
        auth: pieceMetadata?.auth,
        authors: pieceMetadata?.authors ?? [],
        platformId: pieceMetadata?.platformId,
        version: pieceMetadata?.version ?? faker.system.semver(),
        minimumSupportedRelease: pieceMetadata?.minimumSupportedRelease ?? '0.0.0',
        maximumSupportedRelease: pieceMetadata?.maximumSupportedRelease ?? '9.9.9',
        actions: pieceMetadata?.actions ?? {},
        triggers: pieceMetadata?.triggers ?? {},
        pieceType: pieceMetadata?.pieceType ?? faker.helpers.enumValue(PieceType),
        packageType:
            pieceMetadata?.packageType ?? faker.helpers.enumValue(PackageType),
        archiveId: pieceMetadata?.archiveId,
        categories: pieceMetadata?.categories ?? [],
        contextInfo: pieceMetadata?.contextInfo ?? { version: LATEST_CONTEXT_VERSION },
    }
}

export const createAuditEvent = (auditEvent: Partial<ApplicationEvent>) => {
    return {
        id: auditEvent.id ?? apId(),
        created: auditEvent.created ?? faker.date.recent().toISOString(),
        updated: auditEvent.updated ?? faker.date.recent().toISOString(),
        ip: auditEvent.ip ?? faker.internet.ip(),
        platformId: auditEvent.platformId,
        userId: auditEvent.userId,
        userEmail: auditEvent.userEmail ?? faker.internet.email(),
        action: auditEvent.action ?? faker.helpers.enumValue(ApplicationEventName),
        data: auditEvent.data ?? {},
    }
}

export const createMockOtp = (otp?: Partial<OtpModel>): OtpModel => {
    const now = dayjs()
    const twentyMinutesAgo = now.subtract(5, 'minutes')

    return {
        id: otp?.id ?? apId(),
        created: otp?.created ?? faker.date.recent().toISOString(),
        updated:
            otp?.updated ??
            faker.date
                .between({ from: twentyMinutesAgo.toDate(), to: now.toDate() })
                .toISOString(),
        type: otp?.type ?? faker.helpers.enumValue(OtpType),
        identityId: otp?.identityId ?? apId(),
        value:
            otp?.value ?? faker.number.int({ min: 100000, max: 999999 }).toString(),
        state: otp?.state ?? faker.helpers.enumValue(OtpState),
    }
}



export const createMockConnection = (connection: Partial<AppConnection>, ownerId: string): AppConnection<AppConnectionType.SECRET_TEXT> => {
    return {
        id: connection?.id ?? apId(),
        created: connection?.created ?? faker.date.recent().toISOString(),
        updated: connection?.updated ?? faker.date.recent().toISOString(),
        platformId: connection?.platformId ?? apId(),
        projectIds: connection?.projectIds ?? [],
        pieceName: connection?.pieceName ?? faker.lorem.word(),
        displayName: connection?.displayName ?? faker.lorem.word(),
        type: AppConnectionType.SECRET_TEXT,
        scope: AppConnectionScope.PROJECT,
        status: AppConnectionStatus.ACTIVE,
        ownerId,
        value: {
            type: AppConnectionType.SECRET_TEXT,
            secret_text: faker.lorem.word(),
        },
        metadata: connection?.metadata ?? {},
        externalId: connection?.externalId ?? apId(),
        owner: null,
        pieceVersion: connection?.pieceVersion ?? '0.0.0',
        preSelectForNewProjects: connection?.preSelectForNewProjects ?? false,
    }
}

export const createMockTable = ({ projectId }: { projectId: string }): Table => {
    return {
        id: apId(),
        created: faker.date.recent().toISOString(),
        updated: faker.date.recent().toISOString(),
        projectId,
        externalId: apId(),
        name: faker.lorem.word(),
    }
}

export const createMockField = ({ tableId, projectId, position }: { tableId: string, projectId: string, position?: number }): Field => {
    return {
        id: apId(),
        created: faker.date.recent().toISOString(),
        updated: faker.date.recent().toISOString(),
        tableId,
        name: faker.lorem.word(),
        data: {
            options: [],
        },
        externalId: apId(),
        projectId,
        type: FieldType.STATIC_DROPDOWN,
        position: position ?? 0,
    }
}
export const createMockRecord = ({ tableId, projectId }: { tableId: string, projectId: string }): Record => {
    return {
        id: apId(),
        created: faker.date.recent().toISOString(),
        updated: faker.date.recent().toISOString(),
        tableId,
        projectId,
    }
}

export const createMockCell = ({ recordId, fieldId, projectId }: { recordId: string, fieldId: string, projectId: string }): Cell => {
    return {
        id: apId(),
        created: faker.date.recent().toISOString(),
        updated: faker.date.recent().toISOString(),
        recordId,
        fieldId,
        projectId,
        value: faker.lorem.word(),
    }
}


// REMOVED: `createMockSolutionAndSave` / `checkIfSolutionExistsInDb` / the `Solution`
// type built a table+connection+flow+flowVersion+flowRun graph to assert project-delete
// cascade. `flow`/`flow_version`/`flow_run` and their `createMockFlow*` mocks were
// deleted with the Flow Runtime, so the helpers referenced undefined identifiers and
// threw whenever called. The project-deletion tests that used them are migrated to the
// surviving entities.
// REMOVED (same class): `createMockGitRepo` — the git-sync feature's API surface is
// gone, its `GitRepo`/`GitBranchType` imports were dropped from this file (so the
// helper referenced undefined identifiers), and its default `git@${faker.internet.url()}`
// remote was an impossible URL (`git@https://...`). It had no callers left.

export const mockBasicUser = async ({ userIdentity, user }: { userIdentity?: Partial<UserIdentity>, user?: Partial<User> }) => {
    const mockUserIdentity = createMockUserIdentity({
        verified: true,
        ...userIdentity,
    })
    await databaseConnection().getRepository('user_identity').save(mockUserIdentity)
    const mockUser = createMockUser({
        ...user,
        identityId: mockUserIdentity.id,
    })
    await databaseConnection().getRepository('user').save(mockUser)
    return {
        mockUserIdentity,
        mockUser,
    }
}
export const mockAndSaveBasicSetup = async (params?: MockBasicSetupParams): Promise<MockBasicSetup> => {
    const mockUserIdentity = createMockUserIdentity({
        verified: true,
        ...params?.userIdentity,
    })
    await databaseConnection().getRepository('user_identity').save(mockUserIdentity)

    const mockOwner = createMockUser({
        ...params?.user,
        identityId: mockUserIdentity.id,
        platformRole: PlatformRole.ADMIN,
    })
    await databaseConnection().getRepository('user').save(mockOwner)

    const mockPlatform = createMockPlatform({
        ...params?.platform,
        ownerId: mockOwner.id,
        filteredPieceBehavior: params?.platform?.filteredPieceBehavior ?? FilteredPieceBehavior.BLOCKED,
    })

    await databaseConnection().getRepository('platform').save(mockPlatform)
    const hasPlanTable = databaseConnection().hasMetadata(PlatformPlanEntity)
    if (hasPlanTable) {
        const mockPlatformPlan = createMockPlatformPlan({
            platformId: mockPlatform.id,
            auditLogEnabled: true,
            apiKeysEnabled: true,
            customRolesEnabled: true,
            teamProjectsLimit: TeamProjectsLimit.UNLIMITED,
            includedAiCredits: 1000,
            ...params?.plan,
        })
        await databaseConnection().getRepository('platform_plan').upsert(mockPlatformPlan, ['platformId'])
    }

    mockOwner.platformId = mockPlatform.id
    await databaseConnection().getRepository('user').save(mockOwner)

    const mockProject = createMockProject({
        ...params?.project,
        ownerId: mockOwner.id,
        platformId: mockPlatform.id,
    })
    await databaseConnection().getRepository('project').save(mockProject)

    return {
        mockUserIdentity,
        mockOwner,
        mockPlatform,
        mockProject,
    }
}

type MockBasicSetupWithApiKey = MockBasicSetup & { mockApiKey: ApiKey & { value: string } }
export const mockAndSaveBasicSetupWithApiKey = async (params?: MockBasicSetupParams): Promise<MockBasicSetupWithApiKey> => {
    const basicSetup = await mockAndSaveBasicSetup(params)

    const mockApiKey = createMockApiKey({
        platformId: basicSetup.mockPlatform.id,
    })
    await databaseConnection().getRepository('api_key').save(mockApiKey)

    return {
        ...basicSetup,
        mockApiKey,
    }
}

export const createMockFile = (file?: Partial<File>): File => {
    const hasExplicitProjectId = file !== undefined && 'projectId' in file
    const hasExplicitPlatformId = file !== undefined && 'platformId' in file
    return {
        id: file?.id ?? apId(),
        created: file?.created ?? faker.date.recent().toISOString(),
        updated: file?.updated ?? faker.date.recent().toISOString(),
        platformId: hasExplicitPlatformId ? (file?.platformId ?? null) : apId(),
        projectId: hasExplicitProjectId ? (file?.projectId ?? null) : apId(),
        location: file?.location ?? FileLocation.DB,
        compression: file?.compression ?? faker.helpers.enumValue(FileCompression),
        data: file?.data ?? Buffer.from(faker.lorem.paragraphs()),
        type: file?.type ?? faker.helpers.enumValue(FileType),
        fileName: file?.fileName ?? null,
        metadata: file?.metadata ?? null,
        s3Key: file?.s3Key ?? null,
        size: file?.size ?? null,
    }
}

export const createMockProjectRole = (projectRole?: Partial<ProjectRole>): ProjectRole => {
    return {
        id: projectRole?.id ?? apId(),
        name: projectRole?.name ?? faker.lorem.word(),
        created: projectRole?.created ?? faker.date.recent().toISOString(),
        updated: projectRole?.updated ?? faker.date.recent().toISOString(),
        permissions: projectRole?.permissions ?? [],
        platformId: projectRole?.platformId ?? apId(),
        type: projectRole?.type ?? faker.helpers.enumValue(RoleType),
    }
}



export const createMockAIProvider = async (aiProvider?: Partial<AIProvider>): Promise<Omit<AIProviderSchema, 'platform'>> => {
    return {
        id: aiProvider?.id ?? apId(),
        created: aiProvider?.created ?? faker.date.recent().toISOString(),
        updated: aiProvider?.updated ?? faker.date.recent().toISOString(),
        platformId: aiProvider?.platformId ?? apId(),
        provider: aiProvider?.provider ?? faker.helpers.enumValue(AIProviderName),
        displayName: aiProvider?.displayName ?? faker.lorem.word(),
        auth: await encryptUtils.encryptObject({
            apiKey: process.env.OPENAI_API_KEY ?? faker.string.uuid(),
        }),
        config: aiProvider?.config ?? {},
        enabledForChat: aiProvider?.provider === AIProviderName.ACTIVEPIECES ? true : false,
    }

}

export const mockAndSaveAIProvider = async (params?: Partial<AIProvider>): Promise<Omit<AIProviderSchema, 'platform'>> => {
    const mockAIProvider = await createMockAIProvider(params)
    await databaseConnection().getRepository('ai_provider').upsert(mockAIProvider, ['platformId', 'provider'])
    return mockAIProvider
}

export const mockPieceMetadata = async (mockLog: FastifyBaseLogger): Promise<PieceMetadata> => {
    const { mockPlatform } = await mockAndSaveBasicSetup()
    const mockPieceMetadata = createMockPieceMetadata({
        platformId: mockPlatform.id,
        packageType: PackageType.REGISTRY,
    })
    await databaseConnection().getRepository('integration_metadata').save([mockPieceMetadata])
    pieceMetadataService(mockLog).getOrThrow = vi.fn().mockResolvedValue(mockPieceMetadata)
    return mockPieceMetadata
}



export const createMockEventDestination = (eventDestination?: Partial<{
    id: string
    created: string
    updated: string
    platformId: string
    projectId: string | null
    events: ApplicationEventName[]
    url: string
    scope: EventDestinationScope
}>): {
    id: string
    created: string
    updated: string
    platformId: string
    projectId: string | null
    events: ApplicationEventName[]
    url: string
    scope: EventDestinationScope
} => {
    return {
        id: eventDestination?.id ?? apId(),
        created: eventDestination?.created ?? faker.date.recent().toISOString(),
        updated: eventDestination?.updated ?? faker.date.recent().toISOString(),
        platformId: eventDestination?.platformId ?? apId(),
        projectId: eventDestination?.projectId ?? null,
        events: eventDestination?.events ?? [faker.helpers.enumValue(ApplicationEventName)],
        url: eventDestination?.url ?? faker.internet.url(),
        scope: eventDestination?.scope ?? EventDestinationScope.PLATFORM,
    }
}

type CreateMockPlatformWithOwnerParams = {
    platform?: Partial<Omit<Platform, 'ownerId'>>
    owner?: Partial<Omit<User, 'platformId'>>
}

type CreateMockPlatformWithOwnerReturn = {
    mockPlatform: Platform
    mockOwner: User
    mockUserIdentity: UserIdentity
}


type MockBasicSetup = {
    mockOwner: User
    mockPlatform: Platform
    mockProject: Project
    mockUserIdentity: UserIdentity
}

type MockBasicSetupParams = {
    userIdentity?: Partial<UserIdentity>
    user?: Partial<User>
    plan?: Partial<PlatformPlan>
    platform?: Partial<Platform>
    project?: Partial<Project>
}
