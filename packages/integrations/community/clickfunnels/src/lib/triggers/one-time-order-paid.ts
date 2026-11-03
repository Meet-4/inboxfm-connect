import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { clickfunnelsAuth } from '../common/constants';
import { teamsDropdown, workspacesDropdown } from '../common/props';
import { clickfunnelsApiService } from '../common/requests';

const CACHE_KEY = 'clickfunnels_onetime_order_paid_trigger';
const MODULE_NAME = 'One-Time Order Paid';

export const oneTimeOrderPaid = createTrigger({
  auth: clickfunnelsAuth,
  name: 'OneTimeOrderPaid',
  displayName: MODULE_NAME,
  description: 'Triggers when a customer pays a one-time order.',
  aiMetadata: {
    description:
      'Fires when a one-time (non-subscription) order is completed/paid in the selected ClickFunnels workspace, representing a successful single-purchase payment. Delivers the order payload.',
  },
  props: {
    teamId: teamsDropdown(['auth']),
    workspaceId: workspacesDropdown(['auth', 'teamId']),
  },
  sampleData: {
    data: {
      id: 22642,
      public_id: 'JmRRyN',
      order_number: '#2146',
      workspace_id: 4,
      contact_id: 22440,
      live_mode: true,
      total_amount: '396.00',
      currency: 'USD',
      origination_channel_id: 11,
      origination_channel_type: 'Platform::Application',
      shipping_address_first_name: 'Caroll',
      shipping_address_last_name: 'Kirlin',
      shipping_address_organization_name: 'Testing, Inc.',
      shipping_address_phone_number: '+190555501234',
      shipping_address_street_one: '3443 W Bavaria St',
      shipping_address_street_two: '',
      shipping_address_city: 'Eagle',
      shipping_address_region: 'ID',
      shipping_address_country: 'US',
      shipping_address_postal_code: '83616',
      billing_address_street_one: '3443 W Bavaria St',
      billing_address_street_two: '',
      billing_address_city: 'Eagle',
      billing_address_region: 'ID',
      billing_address_country: 'US',
      billing_address_postal_code: '83616',
      recurring_invoices_paid_count: 0,
      page_id: null,
      notes: null,
      in_trial: false,
      billing_status: 'paid',
      service_status: 'completed',
      order_type: 'one-time-order',
      next_charge_at: null,
      renewal_at: null,
      tax_amount: '0.00',
      trial_end_at: null,
      tag_ids: [],
      activated_at: '2026-10-15T10:30:00.000Z',
      canceled_at: null,
      created_at: '2026-10-15T10:29:58.000Z',
      updated_at: '2026-10-15T10:30:00.000Z',
      payment_processor: 'stripe',
    },
    event_id: '9d3a2f71-2b64-4f61-8b1d-4f6dc0f6a1c2',
    event_type: 'one-time-order.completed',
    subject_id: 22642,
    subject_type: 'Order',
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
            event_type_ids: ['one-time-order.completed'],
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

