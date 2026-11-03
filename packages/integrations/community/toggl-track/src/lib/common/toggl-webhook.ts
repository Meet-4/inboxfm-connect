import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

/**
 * Toggl Track webhook deliveries are envelopes:
 *
 * {
 *   "event_id": ...,
 *   "created_at": "...",
 *   "metadata": { "model": "project", "action": "created", ... },
 *   "payload": { ...entity... }
 * }
 *
 * The event type is `<model>.<action>` — `model` is one of client, project,
 * project_group, project_user, tag, task, time_entry, workspace,
 * workspace_user and `action` is created/updated/deleted, matching the
 * event filters a subscription is registered with.
 * Docs: https://engineering.toggl.com/docs/track/webhooks_start and
 * https://github.com/toggl/toggl_api_docs/blob/master/webhooks.md
 */
export const TOGGL_WEBHOOK_MODELS = {
  CLIENT: 'client',
  PROJECT: 'project',
  TAG: 'tag',
  TASK: 'task',
  TIME_ENTRY: 'time_entry',
  WORKSPACE: 'workspace',
} as const;

export const TOGGL_WEBHOOK_ACTIONS = {
  CREATED: 'created',
  UPDATED: 'updated',
  DELETED: 'deleted',
} as const;

/**
 * Toggl sends a special "ping" event (body.payload === "ping", plus
 * validation_code/validation_code_url) to validate the webhook's URL
 * endpoint. Completes the asynchronous validation handshake (GET the
 * validation_code_url) and reports whether the delivery was a ping, so the
 * trigger can complete validation without emitting a spurious event.
 */
export async function handleTogglValidationPing(body: any): Promise<boolean> {
  if (
    body?.payload === 'ping' ||
    body?.validation_code ||
    body?.validation_code_url
  ) {
    if (body?.validation_code_url) {
      try {
        await httpClient.sendRequest({
          method: HttpMethod.GET,
          url: body.validation_code_url,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      } catch (error) {
        console.error('Failed to auto-validate webhook:', error);
      }
    }
    return true;
  }
  return false;
}

/**
 * Returns the entity carried by a Toggl webhook delivery when it matches the
 * given model/action (e.g. 'client' + 'created'), or undefined when the
 * delivery is for any other event type. A Toggl webhook subscription can
 * carry several event filters (the Free plan allows up to 3 per webhook), so
 * each trigger must filter deliveries itself instead of emitting everything
 * the subscription receives.
 */
export function getTogglEntity(body: any, model: string, action: string): any {
  if (
    body?.metadata?.model === model &&
    body?.metadata?.action === action &&
    body.payload !== undefined
  ) {
    return body.payload;
  }
  return undefined;
}
