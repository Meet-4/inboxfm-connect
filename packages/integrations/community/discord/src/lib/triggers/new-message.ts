import {
  DedupeStrategy,
  HttpMethod,
  HttpRequest,
  Polling,
  httpClient,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
  AppConnectionValueForAuthProperty,
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import dayjs from 'dayjs';
import { discordAuth } from '../auth';
import { discordCommon } from '../common';

import { Message } from '../common/models';

const polling: Polling<AppConnectionValueForAuthProperty<typeof discordAuth>, { channel: string | undefined; limit: number }> =
  {
    strategy: DedupeStrategy.TIMEBASED,
    items: async ({ auth, propsValue: { channel, limit } }) => {
      if (channel === undefined) return [];

      const request: HttpRequest = {
        method: HttpMethod.GET,
        url:
          'https://discord.com/api/v9/channels/' +
          channel +
          '/messages?limit=' +
          limit,
        headers: {
           Authorization: 'Bot ' + auth.secret_text,
        },
      };

      const res = await httpClient.sendRequest<Message[]>(request);

      const items = res.body;
      return items.map((item) => ({
        epochMilliSeconds: dayjs(item.timestamp).valueOf(),
        data: item,
      }));
    },
  };

export const newMessage = createTrigger({
  auth: discordAuth,
  name: 'new_message',
  displayName: 'New message',
  description: 'Triggers when a message is sent in a channel',
  aiMetadata: {
    description: 'Fires when a new message is posted in the selected Discord channel, emitting one event per message. Polls the channel periodically, so detection is near-real-time rather than instant.',
  },
  type: TriggerStrategy.POLLING,
  props: {
    limit: Property.Number({
      displayName: 'Limit',
      description: 'The number of messages to fetch',
      required: false,
      defaultValue: 50,
    }),
    channel: discordCommon.channel,
  },
  sampleData: {
    id: '1294312755767377920',
    type: 0,
    content: 'The deployment is done, please review',
    channel_id: '1029384756473829104',
    author: {
      id: '803511102246784512',
      username: 'jane.doe',
    },
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    pinned: false,
    mention_everyone: false,
    tts: false,
    timestamp: '2026-10-15T10:30:00.000000+00:00',
    edited_timestamp: null,
    flags: 0,
    components: [],
  },
  onEnable: async (context) => {
    await pollingHelper.onEnable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: {
        channel: context.propsValue.channel,
        limit: context.propsValue.limit ?? 50,
      },
    });
  },
  onDisable: async (context) => {
    await pollingHelper.onDisable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: {
        channel: context.propsValue.channel,
        limit: context.propsValue.limit ?? 50,
      },
    });
  },
  run: async (context) => {
    return await pollingHelper.poll(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: {
        channel: context.propsValue.channel,
        limit: context.propsValue.limit ?? 50,
      },
      files: context.files,
    });
  },
  test: async (context) => {
    return await pollingHelper.test(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: {
        channel: context.propsValue.channel,
        limit: context.propsValue.limit ?? 50,
      },
      files: context.files,
    });
  },
});

