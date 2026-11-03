import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { clickfunnelsAuth } from '../common/constants';
import { teamsDropdown, workspacesDropdown } from '../common/props';
import { clickfunnelsApiService } from '../common/requests';

const CACHE_KEY = 'clickfunnels_scheduled_appointment_event_created_trigger';
const MODULE_NAME = 'Scheduled Appointment Event';

export const scheduledAppointmentEventCreated = createTrigger({
  auth: clickfunnelsAuth,
  name: 'scheduledAppointmentEventCreated',
  displayName: `${MODULE_NAME} Created`,
  description: 'Triggers when a scheduled appointment event is created.',
  aiMetadata: {
    description:
      'Fires when a scheduled appointment event is created in the selected ClickFunnels workspace, representing a newly booked appointment. Delivers the appointment event payload.',
  },
  props: {
    teamId: teamsDropdown(['auth']),
    workspaceId: workspacesDropdown(['auth', 'teamId']),
  },
  sampleData: {
    data: {
      id: 12345,
      public_id: 'asdflkj',
      workspace_id: 789,
      event_type: {
        name: 'Boost Conversions With Jaime',
      },
      start_on: '2026-11-05T16:30:00.000Z',
      end_on: '2026-11-05T17:00:00.000Z',
      status: 'scheduled',
      max_invitees: 1,
      order_id: null,
      primary_contact: {
        id: 234,
        public_id: 'asdfkj',
        email_address: 'sdfa@asdf.com',
        first_name: 'John',
        last_name: 'Snow',
        phone_number: '+3439482094',
      },
      tzid: 'America/New_York',
      comments: 'I\'m bringing my dog to the meeting',
      created_at: '2026-10-15T15:01:00.000Z',
      updated_at: '2026-10-15T15:01:00.000Z',
    },
    event_id: '9d3a2f71-2b64-4f61-8b1d-4f6dc0f6a1c2',
    event_type: 'appointments/scheduled_event.created',
    subject_id: 12345,
    subject_type: 'Appointments::ScheduledEvent',
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
            event_type_ids: ['appointments/scheduled_event.created'],
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

