import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { pagerDutyAuth } from '../auth';
import { instructionProp } from '../common/props';
import { createWebhookSubscription, deleteWebhookSubscription } from '../common/client';

const WEBHOOK_SUBSCRIPTION_STORE_KEY = 'pagerduty_new_incident_webhook_subscription_id';

export const newIncident = createTrigger({
  auth: pagerDutyAuth,
  name: 'newIncident',
  displayName: 'New Incident',
  description: 'Triggers when a new incident is created',
  aiMetadata: {
    description:
      'Fires when a new incident is triggered (opened) in PagerDuty, on the incident.triggered webhook event. Represents a freshly raised incident, carrying its details, service, assignees, and urgency.',
  },
  props: {
    instruction: instructionProp,
  },
  sampleData: {
    event: {
      id: '01AAAAAAAAAAAAAAAAAAAAAAAAA0',
      event_type: 'incident.triggered',
      resource_type: 'incident',
      occurred_at: '2024-01-01T00:00:00.000Z',
      agent: {
        id: 'PABC123',
        type: 'user_reference',
        self: 'https://api.pagerduty.com/users/PABC123',
        html_url: 'https://your-subdomain.pagerduty.com/users/PABC123',
        summary: 'Jane Doe',
      },
      client: null,
      data: {
        id: 'QABC1234567890',
        type: 'incident',
        self: 'https://api.pagerduty.com/incidents/QABC1234567890',
        html_url:
          'https://your-subdomain.pagerduty.com/incidents/QABC1234567890',
        number: 1,
        status: 'triggered',
        incident_key: 'abc123def456abc123def456abc12345',
        created_at: '2024-01-01T00:00:00Z',
        reopened_at: null,
        title: 'High CPU usage on production server',
        service: {
          id: 'PSVC123',
          type: 'service_reference',
          self: 'https://api.pagerduty.com/services/PSVC123',
          html_url: 'https://your-subdomain.pagerduty.com/services/PSVC123',
          summary: 'Production API',
        },
        assignees: [
          {
            id: 'PABC123',
            type: 'user_reference',
            self: 'https://api.pagerduty.com/users/PABC123',
            html_url: 'https://your-subdomain.pagerduty.com/users/PABC123',
            summary: 'Jane Doe',
          },
        ],
        escalation_policy: {
          id: 'PESC123',
          type: 'escalation_policy_reference',
          self: 'https://api.pagerduty.com/escalation_policies/PESC123',
          html_url:
            'https://your-subdomain.pagerduty.com/escalation_policies/PESC123',
          summary: 'Default',
        },
        teams: [],
        priority: {
          id: 'PPRI123',
          type: 'priority_reference',
          self: 'https://api.pagerduty.com/priorities/PPRI123',
          html_url:
            'https://your-subdomain.pagerduty.com/account/settings/incidents',
          summary: 'P1',
        },
        urgency: 'high',
        conference_bridge: null,
        resolve_reason: null,
        incident_type: { name: 'incident_default' },
      },
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const subscriptionId = await createWebhookSubscription(
      context.auth.secret_text,
      context.webhookUrl,
      ['incident.triggered']
    );
    await context.store.put(WEBHOOK_SUBSCRIPTION_STORE_KEY, subscriptionId);
  },
  async onDisable(context) {
    const subscriptionId = await context.store.get<string>(
      WEBHOOK_SUBSCRIPTION_STORE_KEY
    );
    if (subscriptionId) {
      await deleteWebhookSubscription(context.auth.secret_text, subscriptionId);
    }
    await context.store.delete(WEBHOOK_SUBSCRIPTION_STORE_KEY);
  },
  async run(context) {
    const payload = context.payload.body as { event?: { event_type?: string } };

    if (payload?.event?.event_type !== 'incident.triggered') {
      return [];
    }
    return [payload];
  },
});
