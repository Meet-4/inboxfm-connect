import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { clickfunnelsAuth } from '../common/constants';
import { teamsDropdown, workspacesDropdown } from '../common/props';
import { clickfunnelsApiService } from '../common/requests';

const CACHE_KEY = 'clickfunnels_contact_identified_trigger';
const MODULE_NAME = 'Contact Identified';

export const contactIdentified = createTrigger({
  auth: clickfunnelsAuth,
  name: 'contactIdentified',
  displayName: MODULE_NAME,
  description: 'Triggers when a new contact is identified by email/phone.',
  aiMetadata: {
    description:
      'Fires when a contact is identified (by email or phone) in the selected ClickFunnels workspace, representing a visitor becoming a known contact. Delivers the contact payload.',
  },
  props: {
    teamId: teamsDropdown(['auth']),
    workspaceId: workspacesDropdown(['auth', 'teamId']),
  },
  sampleData: {
    data: {
      id: 236296209,
      tags: [],
      uuid: '31cabea548c19c0495106323678abcac',
      fb_url: null,
      anonymous: 0,
      last_name: 'Dullan',
      public_id: 'BbBNRxw',
      time_zone: null,
      created_at: '2026-10-15T10:16:30.660Z',
      first_name: 'Bob',
      updated_at: '2026-10-15T10:16:45.253Z',
      twitter_url: null,
      website_url: null,
      linkedin_url: null,
      phone_number: '+18475550100',
      workspace_id: 42,
      email_address: 'bob@example.com',
      instagram_url: null,
      unsubscribed_at: null,
      custom_attributes: {
      },
      last_notification_email_sent_at: null,
    },
    event_id: '9d3a2f71-2b64-4f61-8b1d-4f6dc0f6a1c2',
    event_type: 'contact.identified',
    subject_id: 236296209,
    subject_type: 'Contact',
    created_at: '2026-10-15T10:30:00.000Z',
    page_id: null,
    funnel_id: null,
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable({ auth, webhookUrl, propsValue: { workspaceId }, store }) {
    if (!workspaceId) {
      throw new Error('Workspace ID is required. Please select a workspace.');
    }

    try {
      const response: any = await clickfunnelsApiService.createWebhook(
        auth.props,
        workspaceId as string,
        {
          webhooks_outgoing_endpoint: {
            url: webhookUrl,
            name: `ActivePieces ${MODULE_NAME} Webhook - ${Date.now()}`,
            event_type_ids: ['contact.identified'],
          },
        }
      );

      const webhookId = response.id;

      await store.put(CACHE_KEY, { webhookId });
    } catch (error) {
      console.error('Failed to create ClickFunnels webhook:', error);
      throw new Error(
        `Failed to create webhook: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  },
  async onDisable({ auth, store }) {
    const cachedData = (await store.get(CACHE_KEY)) as any;

    if (cachedData) {
      await clickfunnelsApiService
        .deleteWebhook(auth.props, cachedData.webhookId)
        .then(async () => {
          await store.delete(CACHE_KEY);
        });
    }
  },
  async run(context) {
    return [context.payload.body];
  },
});

