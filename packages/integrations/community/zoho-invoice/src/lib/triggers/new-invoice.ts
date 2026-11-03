import {
  AppConnectionValueForAuthProperty,
  PiecePropValueSchema,
  TriggerStrategy,
  createTrigger,
} from '@inboxfm-connect/pieces-framework';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';

import { common } from '../common';

import dayjs from 'dayjs';
import { zohoAuth } from '../..';

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof zohoAuth>,
  Record<string, never>
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, lastFetchEpochMS }) => {
    const currentValues =
      (await common.getInvoices(auth, {
        createdSince: dayjs(lastFetchEpochMS).format('YYYY-MM-DD'),
      })) ?? [];
    const items = (currentValues as any[]).map(
      (item: { created_time: string }) => ({
        epochMilliSeconds: dayjs(item.created_time).valueOf(),
        data: item,
      })
    );
    return items;
  },
};

export const newInvoice = createTrigger({
  auth: zohoAuth,
  name: 'new_invoice',
  displayName: 'New Invoice',
  description: 'Trigger when a new invoice is received.',
  aiMetadata: {
    description:
      'Fires when a new invoice is created in Zoho Invoice. Polls periodically for invoices created since the last check and emits each newly created invoice, with the invoice record as the event payload.',
  },
  props: {},
  type: TriggerStrategy.POLLING,
  onEnable: async (context) => {
    await pollingHelper.onEnable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  onDisable: async (context) => {
    await pollingHelper.onDisable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  run: async (context) => {
    return await pollingHelper.poll(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
      files: context.files,
    });
  },
  test: async (context) => {
    return await pollingHelper.test(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
      files: context.files,
    });
  },

  sampleData: {
    invoice_id: '460000000045033',
    invoice_number: 'INV-00004',
    customer_id: '460000000017103',
    customer_name: 'Bowman and Co',
    status: 'sent',
    date: '2026-10-15',
    due_date: '2026-10-25',
    total: 407.5,
    balance: 407.5,
    created_time: '1762000000',
    line_items: [
      {
        line_item_id: '460000000062003',
        item_id: '460000000027009',
        name: 'Consulting services',
        description: 'October retainer',
        rate: 350,
        quantity: 1,
        unit: null,
        amount: 350,
        discount: 0,
      },
    ],
  },
});
