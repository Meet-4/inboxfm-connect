import {
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { greipAuth } from '../common/auth';

export const spamEmailDetectedTrigger = createTrigger({
  name: 'spam_email_detected',
  displayName: 'Spam Email Detected',
  description: 'Triggers when a new email is marked as SPAM by Greip',
  aiMetadata: {
    description: 'Fires when Greip marks an email address as spam/invalid, carrying the score and the reason it failed. Delivered via a Greip webhook (spam_email event) that must be configured manually in the Greip dashboard.',
  },
  auth: greipAuth,
  props: {
    webhookInstructions: Property.MarkDown({
      value: `
To use this trigger, you need to manually set up a webhook in your Greip account:

1. Login to your Greip dashboard.
2. Go to Settings > Integrations > Webhooks.
3. Click on "Add Webhook" or "Create New Webhook".
4. Add the following URL in the **Webhook URL** field:
\`\`\`text
{{webhookUrl}}
\`\`\`
5. Select **spam_email** from the event types.
6. Click Save to create the webhook.

**Note:** Webhooks are only available for paid subscriptions.
      `,
    }),
  },
  type: TriggerStrategy.WEBHOOK,
  sampleData: {
    event: 'spam_email',
    email: 'name@domain.com',
    score: 3,
    reason: 'Email domain\'s SPF record is not set properly.',
    isValid: false,
  },
  async onEnable(context) {
    // Webhooks are set up manually in Greip dashboard
  },
  async onDisable(context) {
    // Webhooks are removed manually in Greip dashboard
  },
  async run(context) {
    // A Greip webhook URL can be configured to receive several event types
    // (docs.greip.io webhooks: one URL delivers each of fraud_payment,
    // proxy_detected, profanity, spam_email, spam_phone), and every delivery
    // carries the event name in `event`, so filter to this trigger's event.
    const body = context.payload.body as { event?: string };
    if (!body || body.event !== 'spam_email') {
      return [];
    }
    return [body];
  },
});


