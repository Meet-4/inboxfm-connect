import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { clickfunnelsAuth } from '../common/constants';
import { teamsDropdown, workspacesDropdown } from '../common/props';
import { clickfunnelsApiService } from '../common/requests';

const CACHE_KEY = 'clickfunnels_subscription_invoice_paid_trigger';
const MODULE_NAME = 'Subscription Invoice Paid';

export const subscriptionInvoicePaid = createTrigger({
  auth: clickfunnelsAuth,
  name: 'subscriptionInvoicePaid',
  displayName: MODULE_NAME,
  description: 'Triggers when a subscription invoice is paid.',
  aiMetadata: {
    description:
      'Fires when a subscription invoice is paid in the selected ClickFunnels workspace, representing a successful recurring-billing payment. Delivers the invoice payload.',
  },
  props: {
    teamId: teamsDropdown(['auth']),
    workspaceId: workspacesDropdown(['auth', 'teamId']),
  },
  sampleData: {
    data: {
      id: 33904,
      public_id: 'inR8yW',
      order_id: 22643,
      status: 'paid',
      due_amount: '0.00',
      total_amount: '39.00',
      subtotal_amount: '39.00',
      tax_amount: '0.00',
      shipping_amount: '0.00',
      discount_amount: '0.00',
      currency: 'USD',
      issued_at: '2026-10-15T10:29:59.000Z',
      due_at: '2026-10-15T10:29:59.000Z',
      paid_at: '2026-10-15T10:30:00.000Z',
      invoice_type: 'subscription',
      invoice_number: 'INV-00182',
      fulfillment_status: 'fulfilled',
      created_at: '2026-10-15T10:29:59.000Z',
      updated_at: '2026-10-15T10:30:00.000Z',
      external_id: 'in_1QxK3fAbCdEfGhij',
      payment_processor: 'stripe',
      eligible_for_fulfillment: true,
      line_items: [
        {
        id: 84112,
        public_id: 'liXk3f',
        invoice_id: 33904,
        external_id: 'li_1QxK3f',
        payment_type: 'subscription',
        description: 'Pro Plan — monthly',
        quantity: 1,
        fulfillment_status: 'fulfilled',
        amount: '39.00',
        created_at: '2026-10-15T10:30:00.000Z',
        updated_at: '2026-10-15T10:30:00.000Z',
        },
      ],
      order: {
        id: 22643,
        public_id: 'JmRRyO',
        order_type: 'subscription',
        currency: 'USD',
        total_amount: '39.00',
        billing_status: 'paid',
        service_status: 'active',
        workspace_id: 4,
        contact_id: 22440,
        live_mode: true,
        in_trial: false,
      },
    },
    event_id: '9d3a2f71-2b64-4f61-8b1d-4f6dc0f6a1c2',
    event_type: 'subscription.invoice.paid',
    subject_id: 33904,
    subject_type: 'Orders::Invoice',
    created_at: '2026-10-15T10:30:00.000Z',
    page_id: null,
    funnel_id: null,
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable({ auth, webhookUrl, propsValue: { workspaceId }, store }) {
    if (!workspaceId) {
      throw new Error('Workspace ID is required. Please select a workspace.');
    }

    try {
      const response: any = await clickfunnelsApiService.createWebhook(
        auth.props,
        workspaceId as string,
        {
          webhooks_outgoing_endpoint: {
            url: webhookUrl,
            name: `ActivePieces ${MODULE_NAME} Webhook - ${Date.now()}`,
            event_type_ids: ['subscription.invoice.paid'],
          },
        }
      );

      const webhookId = response.id;

      await store.put(CACHE_KEY, { webhookId });
    } catch (error) {
      console.error('Failed to create ClickFunnels webhook:', error);
      throw new Error(
        `Failed to create webhook: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  },
  async onDisable({ auth, store }) {
    const cachedData = (await store.get(CACHE_KEY)) as any;

    if (cachedData) {
      await clickfunnelsApiService
        .deleteWebhook(auth.props, cachedData.webhookId)
        .then(async () => {
          await store.delete(CACHE_KEY);
        });
    }
  },
  async run(context) {
    return [context.payload.body];
  },
});

