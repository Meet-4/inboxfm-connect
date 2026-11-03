import {
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { togglTrackAuth } from '../..';
import { togglCommon } from '../common';
import {
  generateTogglWebhookInstructions,
  TOGGL_WEBHOOK_EVENTS,
} from '../common/webhook-instructions';
import {
  getTogglEntity,
  handleTogglValidationPing,
  TOGGL_WEBHOOK_ACTIONS,
  TOGGL_WEBHOOK_MODELS,
} from '../common/toggl-webhook';

export const newClient = createTrigger({
  auth: togglTrackAuth,
  name: 'new_client',
  displayName: 'New Client',
  description: 'Fires when a new client is created in a workspace.',
  aiMetadata: {
    description: 'Fires when a new client is created in the configured Toggl Track workspace, delivering the created client (id, name, notes, workspace). Delivered via a Toggl webhook the user must set up manually.',
  },
  props: {
    workspace_id: togglCommon.workspace_id,
    setupInstructions: Property.MarkDown({
      value: generateTogglWebhookInstructions(
        TOGGL_WEBHOOK_EVENTS.CLIENT_CREATED,
        'New Client',
        'Create a test client to ensure events are received',
        `This trigger will fire when clients are created and will include:
- Client ID and details
- Workspace information
- Creation timestamp
- Creator information
- Client notes and status`
      ),
    }),
  },
  sampleData: {
    id: 123456,
    name: 'Acme Corporation',
    wid: 987654,
    archived: false,
    at: '2025-08-29T10:15:30+00:00',
    creator_id: 6,
    notes: 'Important client for Q4 projects',
  },
  type: TriggerStrategy.WEBHOOK,


  async onEnable(context) {
    // Manual setup - no programmatic registration needed
  },

  async onDisable(context) {
    // Manual setup - users manage webhooks in Toggl Track UI
  },

  async run(context) {
    const body = context.payload.body as any;

    // Toggl sends a special "ping" event to validate the webhook URL.
    // Complete the validation handshake without emitting it as an event.
    if (await handleTogglValidationPing(body)) {
      return [];
    }

    // Toggl webhooks can subscribe to several event types, so only emit
    // deliveries matching this trigger's declared event ("Client created").
    const client = getTogglEntity(
      body,
      TOGGL_WEBHOOK_MODELS.CLIENT,
      TOGGL_WEBHOOK_ACTIONS.CREATED
    );
    if (!client) {
      return [];
    }

    return [client];
  },
});
