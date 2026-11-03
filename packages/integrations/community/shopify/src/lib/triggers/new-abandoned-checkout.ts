import {
  Polling,
  DedupeStrategy,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { TriggerStrategy, createTrigger } from '@inboxfm-connect/pieces-framework';
import { getAbandonedCheckouts } from '../common';
import { shopifyAuth } from '../..';
import { ShopifyAuth } from '../common/types';

export const newAbandonedCheckout = createTrigger({
  name: 'new_abandoned_checkout',
  auth: shopifyAuth,
  displayName: 'New Abandoned Checkout',
  description: 'Triggers when a checkout is abandoned.',
  aiMetadata: {
    description:
      'Fires when a shopper adds items to their cart and begins the Shopify checkout but leaves without completing the purchase. Each event represents one abandoned checkout, including the line items, contact details, and recovery URL, enabling cart-recovery and follow-up workflows. Detected via polling, so there may be a delay before an abandoned checkout surfaces.',
  },
  props: {},
  sampleData: {
    id: 450789469,
    abandoned_checkout_url: 'https://checkout.example.com/690933842/checkouts/450789469/recover?key=example',
    completed_at: null,
    created_at: '2026-10-15T09:00:00-04:00',
    currency: 'USD',
    customer: {
      id: 207119551,
      email: 'bob@example.com',
      accepts_marketing: false,
      created_at: '2026-09-01T12:00:00-04:00',
      updated_at: '2026-10-15T09:00:00-04:00',
      first_name: 'Bob',
      last_name: 'Dullan',
      orders_count: 0,
      state: 'disabled',
      total_spent: '0.00',
      last_order_id: null,
      note: null,
      verified_email: true,
      tax_exempt: false,
    },
  },
  type: TriggerStrategy.POLLING,
  async onEnable({ auth, propsValue, store }) {
    await pollingHelper.onEnable(polling, { auth, propsValue, store });
  },
  async onDisable({ auth, propsValue, store }) {
    await pollingHelper.onEnable(polling, { auth, propsValue, store });
  },
  async run({ auth, propsValue, store, files }) {
    return await pollingHelper.poll(polling, { auth, propsValue, store, files });
  },
  async test({ auth, propsValue, store, files }) {
    return await pollingHelper.test(polling, { auth, propsValue, store, files });
  },
});

const polling: Polling<ShopifyAuth, unknown> = {
  strategy: DedupeStrategy.LAST_ITEM,
  items: async ({ auth, lastItemId }) => {
    const checkouts = await getAbandonedCheckouts(auth, {
      sinceId: lastItemId as string,
    });
    return checkouts.map((checkout) => ({
      id: checkout.id,
      data: checkout,
    }));
  },
};
