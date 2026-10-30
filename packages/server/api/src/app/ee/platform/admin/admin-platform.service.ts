import { ApplyLicenseKeyByEmailRequestBody, IncreaseAICreditsForPlatformRequestBody, PlatformRole } from '@inboxfm-connect/shared'
import { FastifyBaseLogger } from 'fastify'
import { userIdentityService } from '../../../authentication/user-identity/user-identity-service'
import { platformRepo } from '../../../platform/platform.service'
import { userRepo } from '../../../user/user-service'
import { licenseKeysService } from '../../license-keys/license-keys-service'
import { addOpenRouterKeyLimit, platformAiCreditsService } from '../platform-plan/platform-ai-credits.service'

export const adminPlatformService = (log: FastifyBaseLogger) => ({

    async applyLicenseKeyByEmail({ email, licenseKey }: ApplyLicenseKeyByEmailRequestBody): Promise<void> {
        const identity = await userIdentityService(log).getIdentityByEmail(email)
        if (!identity) {
            throw new Error('User identity not found for email')
        }
        const user = await userRepo().findOneBy({
            identityId: identity.id,
            platformRole: PlatformRole.ADMIN,
        })
        if (!user) {
            throw new Error('User not found for identityId')
        }
        const platform = await platformRepo().findOneBy({
            ownerId: user.id,
        })
        if (!platform) {
            throw new Error('Platform not found for owner')
        }
        const key = await licenseKeysService(log).verifyKeyOrReturnNull({ platformId: platform.id, license: licenseKey })
        if (!key) {
            throw new Error('Invalid or expired license key')
        }
        await licenseKeysService(log).applyLimits(platform.id, key)
    },
    // Routed through addOpenRouterKeyLimit so the grant serializes against the
    // Stripe webhooks and the renewal job on the per-platform lock and drops
    // the cached usage. The inline getKey → limit+N → updateKey it replaced
    // silently erased a concurrent increment and left the 3-minute usage
    // cache reporting the pre-grant balance.
    async increaseAiCredits({ amountInUsd, platformId }: IncreaseAICreditsForPlatformRequestBody): Promise<void> {
        const { apiKeyHash } = await platformAiCreditsService(log).getOrCreateActivePiecesProviderAuthConfig({ platformId })
        await addOpenRouterKeyLimit({ platformId, apiKeyHash, amountUsd: amountInUsd, log })
    },

})
