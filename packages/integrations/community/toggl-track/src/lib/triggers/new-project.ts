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

export const newProject = createTrigger({
  auth: togglTrackAuth,
  name: 'new_project',
  displayName: 'New Project',
  description: 'Fires when a new project is added.',
  aiMetadata: {
    description: 'Fires when a new project is created in the configured Toggl Track workspace, delivering the created project (id, name, client association, billing/color settings). Delivered via a Toggl webhook the user must set up manually.',
  },
  props: {
    workspace_id: togglCommon.workspace_id,
    setupInstructions: Property.MarkDown({
      value: generateTogglWebhookInstructions(
        TOGGL_WEBHOOK_EVENTS.PROJECT_CREATED,
        'New Project',
        'Create a test project to ensure events are received',
        `This trigger will fire when projects are created and will include:
- Project ID and details
- Workspace information
- Client association (if any)
- Creation timestamp
- Creator information
- Project settings (color, billable status, etc.)`
      ),
    }),
  },
  sampleData: {
    id: 123456789,
    workspace_id: 987654,
    client_id: 456789,
    name: 'New Website Development',
    is_private: false,
    active: true,
    at: '2025-08-29T10:15:30+00:00',
    color: '#3750b5',
    billable: true,
    template: false,
    auto_estimates: false,
    estimated_hours: 40,
    rate: 75.0,
    rate_last_updated: null,
    currency: 'USD',
    recurring: false,
    recurring_parameters: null,
    current_period: null,
    fixed_fee: null,
    actual_hours: 0,
    actual_seconds: 0,
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
    // deliveries matching this trigger's declared event ("Project created").
    const project = getTogglEntity(
      body,
      TOGGL_WEBHOOK_MODELS.PROJECT,
      TOGGL_WEBHOOK_ACTIONS.CREATED
    );
    if (!project) {
      return [];
    }

    return [project];
  },
});
