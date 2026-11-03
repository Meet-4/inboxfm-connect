import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { ZOHO_WEBHOOK_TOKEN } from '../common/constants';
import { biginAuth } from '../auth';
import { biginApiService } from '../common/request';

const CACHE_KEY = 'bigin_updated_contact_trigger';

export const contactUpdated = createTrigger({
  auth: biginAuth,
  name: 'contactUpdated',
  displayName: 'Contact Updated',
  description: 'Triggers when a contact is updated',
  aiMetadata: {
    description: 'Fires when an existing contact (person) record is edited in Bigin CRM, via a Contacts.edit webhook. Represents a change to a person already in the CRM.',
  },
  props: {},
  sampleData: {
    server_time: 1762000000000,
    query_params: {
    },
    module: 'Contacts',
    resource_uri: 'https://www.zohoapis.com/bigin/v2/Contacts',
    ids: ["1770000123456001"],
    affected_fields: [],
    operation: 'update',
    channel_id: '1770000000000',
    token: 'bigin_webhook_token',
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    try {
      const channel_id = Date.now().toString();
      const { api_domain } = context.auth.data;

      const webhookData = {
        watch: [
          {
            channel_id,
            events: ['Contacts.edit'],
            notify_url: context.webhookUrl,
            token: ZOHO_WEBHOOK_TOKEN,
          },
        ],
      };

      await biginApiService.createWebhook(context.auth.access_token, webhookData, api_domain)

      await context.store.put(CACHE_KEY, channel_id);
    } catch (error) {
      console.error('Failed to enable Zoho webhook');
    }
  },
  async onDisable(context) {
    const channel_id = await context.store.get(CACHE_KEY) as string;
    if (!channel_id) return;

    const { api_domain } = context.auth.data;

    await biginApiService.deleteWebhook(
      context.auth.access_token,
      api_domain,
      channel_id
    );

    await context.store.delete(CACHE_KEY);
  },
  async run(context) {
    const { token } = context.payload.body as any;

    if (token !== ZOHO_WEBHOOK_TOKEN) {
      throw new Error('Invalid webhook token');
    }

    return [context.payload.body];
  },
});
