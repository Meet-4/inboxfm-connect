import {
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { moonclerkAuth } from '../common/auth';
export const planPaymentFailed = createTrigger({
  auth: moonclerkAuth,
  name: 'planPaymentFailed',
  displayName: 'Plan Payment Failed',
  description: 'Triggers when a payment related to a plan has failed.',
  aiMetadata: {
    description: 'Fires when a recurring payment tied to a MoonClerk plan (subscription) fails to collect. Use to handle dunning, failed-renewal alerts, or retry workflows for active subscriptions. Requires a MoonClerk webhook configured for the Plan Payment Failed event.',
  },
  props: {
    markdown: Property.MarkDown({
      value: `## MoonClerk Webhook Setup
                                    To use this trigger, you need to manually set up a webhook in your MoonClerk account:
                        
                                    1. Login to your MoonClerk account.
                                    2. Navigate to **Account** -> **Settings** -> **Webhooks**.
                                    3. **Create webhook Endpoint**. keep state as active.
                                    4. Specify the following URL in the **Webhook URL** field:
                                    \`\`\`text
                                    {{webhookUrl}}
                                    \`\`\`
                                    5. Select the **Plan Payment Failed** event.
                                    5. Click Save Agent.
                                    `,
    }),
  },
  sampleData: {
    id: 53453,
    name: 'Jim Customer',
    email: 'jim@example.com',
    payment_method: {
      type: 'card',
      last4: '4242',
      exp_month: 12,
      exp_year: 2028,
      brand: 'Visa',
    },
    delinquent: true,
    customer_reference: 'cus_4SOZuEc4cxP5L7',
    form_id: 112,
    subscription: {
      id: 98,
      subscription_reference: 'sub_3oLgqlp4MgTZC3',
      status: 'active',
      start: '2026-07-23T13:44:16Z',
      next_payment_attempt: '2026-10-23T13:44:16Z',
      current_period_start: '2026-10-15T10:30:00Z',
      current_period_end: '2026-11-15T10:30:00Z',
      plan: {
        id: 131,
        plan_reference: '131',
        amount: 1200,
        amount_description: 'Option A',
        currency: 'USD',
        interval: 'month',
        interval_count: 1,
      },
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
    return [context.payload.body];
  },
});
