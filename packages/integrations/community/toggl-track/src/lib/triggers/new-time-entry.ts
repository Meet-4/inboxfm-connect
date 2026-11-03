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

export const newTimeEntry = createTrigger({
  auth: togglTrackAuth,
  name: 'new_time_entry',
  displayName: 'New Time Entry',
  description:
    'Fires when a new time entry is added (with optional project/task filter).',
  aiMetadata: {
    description: 'Fires when a new time entry is created in the configured Toggl Track workspace, delivering the entry (start/stop, duration, description, tags, project/task, billable). Can be narrowed to a specific project and/or task via the optional filters. Delivered via a Toggl webhook the user must set up manually.',
  },
  props: {
    workspace_id: togglCommon.workspace_id,
    optional_project_id: togglCommon.optional_project_id,
    task_id: togglCommon.optional_task_id,
    setupInstructions: Property.MarkDown({
      value: generateTogglWebhookInstructions(
        TOGGL_WEBHOOK_EVENTS.TIME_ENTRY_CREATED,
        'New Time Entry',
        'Create a test time entry to ensure events are received',
        `This trigger will fire when time entries are created and will include:
- Time entry ID and details
- Start/stop times and duration
- Project and task associations (if any)
- Workspace information
- Description and tags
- Creator information
- Billable status

**Note:** You can filter time entries by project and task using the optional filters above.`
      ),
    }),
  },
  sampleData: {
    id: 1234567890,
    workspace_id: 987654,
    project_id: 123987456,
    task_id: 789123456,
    billable: false,
    start: '2025-08-29T11:00:00Z',
    stop: '2025-08-29T11:30:00Z',
    duration: 1800,
    description: 'Weekly team meeting',
    tags: ['meeting', 'internal'],
    at: '2025-08-29T11:30:00+00:00',
    user_id: 6,
    created_with: 'Toggl Track',
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
    // deliveries matching this trigger's declared event ("Time entry created").
    const timeEntry = getTogglEntity(
      body,
      TOGGL_WEBHOOK_MODELS.TIME_ENTRY,
      TOGGL_WEBHOOK_ACTIONS.CREATED
    );
    if (!timeEntry) {
      return [];
    }

    if (
      context.propsValue.optional_project_id &&
      timeEntry?.project_id !== undefined
    ) {
      if (
        String(timeEntry.project_id) !==
        String(context.propsValue.optional_project_id)
      ) {
        return [];
      }
    }

    if (context.propsValue.task_id && timeEntry?.task_id !== undefined) {
      if (String(timeEntry.task_id) !== String(context.propsValue.task_id)) {
        return [];
      }
    }

    return [timeEntry];
  },
});
