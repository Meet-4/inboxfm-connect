import {
  createTrigger,
  TriggerStrategy,
  PiecePropValueSchema,
  AppConnectionValueForAuthProperty,
} from '@inboxfm-connect/pieces-framework';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { weblingAuth } from '../auth';
import { WeblingChanges } from '../common/types';
import { getChanges } from '../common/helpers';

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof weblingAuth>,
  { calendarId?: string }
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, propsValue, lastFetchEpochMS }) => {
    const changes: WeblingChanges = await getChanges(auth, lastFetchEpochMS);

    // getChanges always resolves with a changes object, even when nothing
    // changed since the last request. Guard against emitting that empty
    // batch on every poll: without this check, the item below would always
    // be newer than `lastPoll` and the trigger would fire on each poll.
    const changedObjectIds = Object.values(changes.objects ?? {}).reduce(
      (acc, ids) => acc + (ids?.length ?? 0),
      0
    );
    const deletedIds = changes.deleted?.length ?? 0;
    if (changedObjectIds === 0 && deletedIds === 0) {
      return [];
    }

    return [
      {
        epochMilliSeconds: Date.now(),
        data: changes,
      },
    ];
  },
};

export const onChangedData = createTrigger({
  auth: weblingAuth,
  name: 'onChangedData',
  displayName: 'On Changed Data',
  description:
    'Triggers when anything was added, updated or deleted since last request.',
  aiMetadata: {
    description:
      'Fires when any Webling data changes since the last poll, covering creations, updates, and deletions across all object types (members, accounts, calendar events, documents, and more). Represents a batch of changed and deleted record IDs since the previous request, not a single record event.',
  },
  props: {},
  sampleData: {
    objects: {
      account: [244, 246],
      accountgroup: [242],
      accountgrouptemplate: [241],
      accounttemplate: [243, 245, 247, 248, 250],
      apikey: [5241],
      article: [4579, 4580],
      articlegroup: [4578],
      calendar: [235, 4428],
      calendarevent: [4431, 4434, 4435, 4436],
      comment: [4423],
      debitor: [1205, 1208],
      debitorcategory: [650],
      document: [4506],
      documentgroup: [114],
      domain: [1771],
      email: [5085],
      entry: [321, 323, 338],
      entrygroup: [320, 322, 337],
      file: [4525],
      member: [4270, 4271, 398, 399],
      memberform: [4491],
      membergroup: [100],
      page: [4495],
      participant: [4460],
      period: [240],
      periodchain: [239],
      periodgroup: [238],
      settings: [233],
      template: [228],
      user: [120, 343, 345],
    },
    deleted: [235],
    context: [],
    definitions: ['member'],
    settings: false,
    quota: true,
    subscription: true,
    revision: 4758,
    version: 2560,
  },
  type: TriggerStrategy.POLLING,
  async test(context) {
    const { store, auth, propsValue } = context;
    return await pollingHelper.test(polling, {
      store,
      auth,
      propsValue,
      files: context.files,
    });
  },
  async onEnable(context) {
    const { store, auth, propsValue } = context;
    await pollingHelper.onEnable(polling, {
      store,
      auth,
      propsValue,
    });
  },

  async onDisable(context) {
    const { store, auth, propsValue } = context;
    await pollingHelper.onDisable(polling, {
      store,
      auth,
      propsValue,
    });
  },

  async run(context) {
    const { store, auth, propsValue } = context;
    return await pollingHelper.poll(polling, {
      store,
      auth,
      propsValue,
      files: context.files,
    });
  },
});
