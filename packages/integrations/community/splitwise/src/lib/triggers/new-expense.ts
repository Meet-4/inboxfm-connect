import {
  createTrigger,
  Property,
  TriggerStrategy,
  AppConnectionValueForAuthProperty,
  StaticPropsValue,
} from '@inboxfm-connect/pieces-framework';
import { splitwiseAuth } from '../auth';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { splitwiseApi } from '../common/api';

const props = {
  group_id: Property.Dropdown<string, false, typeof splitwiseAuth>({
    displayName: 'Group',
    description: 'Filter expenses from a specific group (optional)',
    required: false,
    auth: splitwiseAuth,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          placeholder: 'Please connect your account first',
          options: [],
        };
      }
      try {
        const groups = await splitwiseApi.getGroups(auth.secret_text);
        return {
          options: [
            { label: 'All Groups', value: '' },
            ...groups.map((group: any) => ({
              label: group.name,
              value: String(group.id),
            })),
          ],
        };
      } catch (error) {
        return {
          disabled: true,
          placeholder: 'Failed to load groups',
          options: [],
        };
      }
    },
  }),
};

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof splitwiseAuth>,
  StaticPropsValue<typeof props>
> = {
  strategy: DedupeStrategy.TIMEBASED,
  async items({ auth, lastFetchEpochMS, propsValue }) {
    const isTest = lastFetchEpochMS === 0;
    const updatedAfter = isTest ? undefined : new Date(lastFetchEpochMS).toISOString();
    const groupIdNum = propsValue.group_id ? parseInt(propsValue.group_id) : undefined;

    const expenses = await splitwiseApi.getExpenses(auth.secret_text, groupIdNum, updatedAfter);

    return expenses.map((expense: any) => ({
      epochMilliSeconds: new Date(expense.created_at).getTime(),
      data: expense,
    }));
  },
};

export const newExpenseTrigger = createTrigger({
  auth: splitwiseAuth,
  name: 'new_expense',
  displayName: 'New Expense',
  description: 'Triggers when a new expense is created. Optionally, filter for a specific group.',
  aiMetadata: {
    description: 'Fires when a new expense appears in the connected Splitwise account, representing a freshly recorded shared bill. Optionally scope to a single group; leave the group unset to watch expenses across all groups.',
  },
  props,
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: 12345678,
    cost: '42.50',
    currency: 'USD',
    description: 'Groceries',
    details: null,
    payment: false,
    creation_method: 'payment',
    date: '2026-10-15T10:30:00Z',
    created_at: '2026-10-15T10:30:00Z',
    created_by: 10001,
    updated_by: 10001,
    updated_at: '2026-10-15T10:30:00Z',
    deleted_at: null,
    group_id: 987654,
    friendship_id: null,
    expense_bundle_id: null,
    repeats: false,
    users: [
      {
        user: {
          id: 10001,
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane.doe@example.com',
        },
        user_id: 10001,
        paid_share: '42.50',
        owed_share: '21.25',
        net_balance: '21.25',
      },
      {
        user: {
          id: 10002,
          first_name: 'Bob',
          last_name: 'Dullan',
          email: 'bob@example.com',
        },
        user_id: 10002,
        paid_share: '0.00',
        owed_share: '21.25',
        net_balance: '-21.25',
      },
    ],
  },
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
  async onEnable(context) {
    await pollingHelper.onEnable(polling, context);
  },
  async onDisable(context) {
    await pollingHelper.onDisable(polling, context);
  },
  async run(context) {
    return await pollingHelper.poll(polling, context);
  },
});
