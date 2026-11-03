import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { clickfunnelsAuth } from '../common/constants';
import { teamsDropdown, workspacesDropdown } from '../common/props';
import { clickfunnelsApiService } from '../common/requests';

const CACHE_KEY = 'clickfunnels_contact_submitted_form_trigger';
const MODULE_NAME = 'Contact Submitted Form';

export const contactSubmittedForm = createTrigger({
  auth: clickfunnelsAuth,
  name: 'contactSubmittedForm',
  displayName: MODULE_NAME,
  description: 'Triggers each time a contact submits a form (opt-in or order).',
  aiMetadata: {
    description:
      'Fires each time a contact submits a form (such as an opt-in or order form) in the selected ClickFunnels workspace. Delivers the form submission payload.',
  },
  props: {
    teamId: teamsDropdown(['auth']),
    workspaceId: workspacesDropdown(['auth', 'teamId']),
  },
  sampleData: {
    data: {
      id: 3101,
      public_id: 'sbU9vW',
      contact_id: 236296209,
      workspace_id: 42,
      page_id: 81023,
      created_at: '2026-10-15T10:30:00.000Z',
      updated_at: '2026-10-15T10:30:00.000Z',
      data: {
        email_address: 'bob@example.com',
        first_name: 'Bob',
        last_name: 'Dullan',
      },
    },
    event_id: '9d3a2f71-2b64-4f61-8b1d-4f6dc0f6a1c2',
    event_type: 'form_submission.created',
    subject_id: 3101,
    subject_type: 'FormSubmission',
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
            event_type_ids: ['form_submission.created'],
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

