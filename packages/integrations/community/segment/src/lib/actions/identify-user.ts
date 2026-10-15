import { segmentAuth } from '../../.';
import { Property, createAction } from '@inboxfm-connect/pieces-framework';
import { Analytics } from '@segment/analytics-node'

export const identifyUser = createAction({
  name: 'identifyUser',
  displayName: 'Identify User',
  description: '',
  audience: 'both',
  aiMetadata: { description: 'Sends a Segment Identify call that associates a user (by required userId) with a set of traits, registering or updating that profile in Segment. Use when an agent needs to record who a user is and their attributes for downstream analytics/tooling. Not idempotent: each call emits a new Identify event.', idempotent: false },
  props: {
    userId: Property.ShortText({
      displayName: 'User ID',
      required: true,
    }),
    traits: Property.Object({
      displayName: 'Traits',
      description: 'The traits to associate with the user',
      required: true,
    }),
  },
  auth: segmentAuth,
  async run(context) {
    const analytics = new Analytics({ writeKey: context.auth.secret_text })
    let deliveryError: unknown
    analytics.on('error', (e) => {
      deliveryError = e.reason ?? e
    })
    analytics.identify({
      userId: context.propsValue.userId,
      traits: context.propsValue.traits,
    })
    // Await the flush (and close this per-run client) so success reflects a
    // completed delivery attempt instead of just queuing; the SDK reports
    // delivery failures through the 'error' event, not flush rejections
    await analytics.flush({ close: true })
    if (deliveryError != null) {
      throw deliveryError
    }
    return {
      success: true,

    }
  },
});
