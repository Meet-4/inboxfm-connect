import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
  AppConnectionValueForAuthProperty,
  createTrigger,
  PiecePropValueSchema,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import dayjs from 'dayjs';
import { microsoft365PlannerAuth, microsoft365PlannerCommon } from '../common';

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof microsoft365PlannerAuth>,
  Record<string, never>
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth }) => {
    const items = await microsoft365PlannerCommon.listPlans({
      auth,
    });
    return items.map((item) => ({
      epochMilliSeconds: dayjs(item.createdDateTime).valueOf(),
      data: item,
    }));
  },
};

export const newPlanCreated = createTrigger({
  auth: microsoft365PlannerAuth,
  name: 'newPlanCreated',
  displayName: 'New Plan Created',
  description: 'Triggers when a new Plan is created in Microsoft 365 Planner.',
  aiMetadata: {
    description: 'Fires when a new plan is created in Microsoft 365 Planner across the authenticated user\'s accessible plans. Polls periodically and emits each newly created plan.',
  },
  props: {},
  sampleData: {
    id: 'xVQeSskM60uetceyKKL7aqMAB0jA',
    title: 'Q3 Launch Plan',
    createdDateTime: '2026-10-15T10:30:00Z',
    owner: 'e5caaa1c-9d77-4a5c-850c-1d9d1a5a1a01',
  },
  type: TriggerStrategy.POLLING,
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
  async onEnable(context) {
    const { store, auth, propsValue } = context;
    await pollingHelper.onEnable(polling, { store, auth, propsValue });
  },

  async onDisable(context) {
    const { store, auth, propsValue } = context;
    await pollingHelper.onDisable(polling, { store, auth, propsValue });
  },

  async run(context) {
    return await pollingHelper.poll(polling, context);
  },
});

