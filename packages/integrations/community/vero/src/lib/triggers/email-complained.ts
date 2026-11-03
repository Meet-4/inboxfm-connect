import {
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { veroAuth } from '../common/auth';
export const emailComplained = createTrigger({
  auth: veroAuth,
  name: 'emailComplained',
  displayName: 'Email Complained',
  description: 'Triggered when an email is marked as complained',
  aiMetadata: {
    description:
      'Fires when a recipient marks an email sent through Vero as spam or files a complaint, representing a spam/abuse report for a specific user and campaign.',
  },
  props: {
    instruction: Property.MarkDown({
      value: `## Vero Webhook Setup
  To enable the webhooks, go to **Settings** > **Integrations** > **Webhooks** and enter the URL at which you wish to receive the webhooks.
  
  \`\`\`text
  {{webhookUrl}}
  \`\`\`
  `,
    }),
  },
  sampleData: {
    complained_at: 1762000000,
    type: 'complained',
    user: {
      id: 123,
      email: 'steve@getvero.com',
    },
    event: {
      data: {
        key: 'value',
      },
      name: 'Test event',
      triggered_at: 1761900000,
    },
    campaign: {
      id: 987,
      type: 'transactional',
      name: 'Order confirmation',
      group: 'Order confirmation - Email 6',
      channel: 'email',
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    // implement webhook creation logic
  },
  async onDisable(context) {
    // implement webhook deletion logic
  },
  async run(context) {
    const body = context.payload.body as any;
    if (body.type === 'complained') {
      return [body];
    }
    return [];
  },
});
