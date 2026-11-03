import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { uscreenAuth } from '../common/auth';
import { uscreenProps } from '../common/props';

const sampleData = {
  id: '123456',
  email: 'newuser@example.com',
  name: 'John Doe',
  tags: ['newsletter', 'trial'],
  opted_in_for_news_and_updates: true,
  opted_in_for_community_updates: false,
  created_at: '2025-10-27T13:00:00Z',
  event: 'user_created',
};

export const newUser = createTrigger({
  auth: uscreenAuth,
  name: 'new_user',
  displayName: 'New User',
  description:
    'Triggers when a new user is added to your storefront.',
  aiMetadata: {
    description: 'Fires when a new user account is created on the Uscreen storefront. Represents a newly registered viewer or subscriber, including their email, name, and any storefront custom fields.',
  },
  props: { setupInstructions: uscreenProps.webhookInstructions() },
  sampleData: sampleData,
  type: TriggerStrategy.WEBHOOK,

  async onEnable(context) {
    //Empty
  },

  async onDisable(context) {
    //Empty
  },

  async run(context) {
    const payload = context.payload.body as unknown as typeof sampleData;

    if (payload?.event !== 'user_created') {
      return [];
    }

    return [payload];
  },

  async test(context) {
    return [sampleData];
  },
});
