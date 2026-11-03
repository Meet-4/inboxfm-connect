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

export const newTag = createTrigger({
  auth: togglTrackAuth,
  name: 'new_tag',
  displayName: 'New Tag',
  description: 'Triggers when a new tag is created',
  aiMetadata: {
    description: 'Fires when a new tag is created in the configured Toggl Track workspace, delivering the created tag (id, name, workspace). Delivered via a Toggl webhook the user must set up manually.',
  },
  props: {
    workspace_id: togglCommon.workspace_id,
    setupInstructions: Property.MarkDown({
      value: generateTogglWebhookInstructions(
        TOGGL_WEBHOOK_EVENTS.TAG_CREATED,
        'New Tag',
        'Create a test tag to ensure events are received',
        `This trigger will fire when tags are created and will include:
- Tag ID and details
- Tag name
- Workspace information
- Creation timestamp
- Creator information`
      ),
    }),
  },
  sampleData: {
    id: 456789,
    name: 'development',
    workspace_id: 987654,
    at: '2025-08-29T10:15:30+00:00',
    creator_id: 6,
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
    // deliveries matching this trigger's declared event ("Tag created").
    const tag = getTogglEntity(
      body,
      TOGGL_WEBHOOK_MODELS.TAG,
      TOGGL_WEBHOOK_ACTIONS.CREATED
    );
    if (!tag) {
      return [];
    }

    return [tag];
  },
});
