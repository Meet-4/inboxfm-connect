import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { CopperAuth } from '../common/constants';
import { CopperApiService } from '../common/requests';

const CACHE_KEY = 'copper_new_person_trigger_key';

export const newPerson = createTrigger({
  auth: CopperAuth,
  name: 'newPerson',
  displayName: 'New Person',
  description: 'Triggers when a new person/contact is created.',
  aiMetadata: {
    description:
      'Fires when a new person (contact) is created in Copper CRM, via a Copper webhook. Emits the newly created person record.',
  },
  props: {},
  sampleData: {
    ids: [13579],
    type: 'person',
    event: 'new',
    subscription_id: 398712,
    timestamp: '2026-10-15T10:30:00.084Z',
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const response = await CopperApiService.createWebhook(context.auth, {
      target: context.webhookUrl,
      type: 'person',
      event: 'new',
    });

    await context.store.put(CACHE_KEY, {
      webhookId: response.id,
    });
  },
  async onDisable(context) {
    const cachedWebhookData = (await context.store.get(CACHE_KEY)) as any;

    if (cachedWebhookData) {
      await CopperApiService.deleteWebhook(
        context.auth,
        cachedWebhookData.webhookId
      ).then(async () => {
        await context.store.delete(CACHE_KEY);
      });
    }
  },
  async run(context) {
    return [context.payload.body];
  },
});

