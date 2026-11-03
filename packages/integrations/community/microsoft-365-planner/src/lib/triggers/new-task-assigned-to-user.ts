import {
    DedupeStrategy,
    Polling,
    pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
  AppConnectionValueForAuthProperty,
    createTrigger,
    PiecePropValueSchema,
    StaticPropsValue,
    TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import dayjs from 'dayjs';
import { microsoft365PlannerAuth, microsoft365PlannerCommon } from '../common';
import { PlanDropdown } from '../common/properties';

const props = {
  planId: PlanDropdown({ required: true }),
};

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof microsoft365PlannerAuth>,
  StaticPropsValue<typeof props>
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, propsValue: { planId } }) => {
    if (!planId) {
      return [];
    }
    const user = await microsoft365PlannerCommon.getUser({ auth });
    if (!user || !user.id) {
      throw new Error('Unable to fetch authenticated user details.');
    }
    const items = await microsoft365PlannerCommon.listTasks({ auth, planId });
    return items
      .filter((item) => {
        const userId = String(user.id);
        return (
          item.assignments &&
          Object.prototype.hasOwnProperty.call(item.assignments, userId)
        );
      })
      .map((item) => ({
        epochMilliSeconds: dayjs(item.createdDateTime).valueOf(),
        data: item,
      }));
  },
};

export const newTaskAssignedToUser = createTrigger({
  auth: microsoft365PlannerAuth,
  name: 'newTaskAssignedToUser',
  displayName: 'New Task Assigned to User',
  description:
    'Triggers when a Task is assigned to the authenticated user in Microsoft 365 Planner.',
  aiMetadata: {
    description: 'Fires when a task within a specified Planner plan is assigned to the authenticated (connected) user. Polls periodically and emits each new task in that plan where the current user is among the assignees.',
  },
  props,
  sampleData: {
    id: 'tkQQOiYO40AssX3tYmhUngAHAETw',
    title: 'Review launch checklist',
    planId: 'xVQeSskM60uetceyKKL7aqMAB0jA',
    bucketId: 'hsGGvg2sk0i3ig0j6M7mggADlgIK',
    createdDateTime: '2026-10-15T10:30:00Z',
    assignments: {
      'e5caaa1c-9d77-4a5c-850c-1d9d1a5a1a01': {
        '@odata.type': 'microsoft.graph.plannerAssignment',
        orderHint: '866511',
      },
    },
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

