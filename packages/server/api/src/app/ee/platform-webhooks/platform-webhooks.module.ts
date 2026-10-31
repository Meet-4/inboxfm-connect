import { FastifyPluginAsync } from 'fastify'
import { eventDestinationService } from '../../event-destinations/event-destinations.service'
import { platformMustHaveFeatureEnabled } from '../authentication/ee-authorization'
import { platformWebhooksController } from './platform-webhooks.controller'

export const platformWebhooksModule: FastifyPluginAsync = async (app) => {
    eventDestinationService(app.log).setup()
    // Event destinations / platform webhooks are the `eventStreamingEnabled`
    // plan entitlement: without this preHandler every cloud-standard or
    // unlicensed EE platform can create and manage them for free (upstream
    // activepieces gates the whole module the same way).
    app.addHook('preHandler', platformMustHaveFeatureEnabled((platform) => platform.plan.eventStreamingEnabled))
    await app.register(platformWebhooksController, { prefix: '/v1/event-destinations' })
}

