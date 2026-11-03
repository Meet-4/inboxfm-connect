import {
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { moonclerkAuth } from '../common/auth';
export const paymentSucceeds = createTrigger({
  auth: moonclerkAuth,
  name: 'paymentSucceeds',
  displayName: 'Payment Succeeds',
  description: '',
  aiMetadata: {
    description: 'Fires when a payment in MoonClerk succeeds (is collected successfully). Use to react only to successful charges, distinct from the New Payment trigger which fires on payments in any state. Requires a MoonClerk webhook configured for the Payment Succeeds event.',
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
                                5. Select the **Payment Succeeds** event.
                                5. Click Save Agent.
                                `,
    }),
  },
  sampleData: {
    id: 1348394,
    date: '2026-10-15T10:30:00Z',
    status: 'successful',
    currency: 'USD',
    amount: 1000,
    fee: 59,
    amount_refunded: 0,
    amount_description: 'Option A',
    name: 'Jim Customer',
    email: 'jim@example.com',
    payment_method: {
      type: 'card',
      last4: '4242',
      brand: 'Visa',
    },
    charge_reference: 'ch_3ohpsF8ra5rqjj',
    customer_id: 53453,
    customer_reference: 'cus_4SOZuEc4cxP5L7',
    form_id: 112,
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
