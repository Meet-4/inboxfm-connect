import {
    DedupeStrategy,
    Polling,
    pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
    createTrigger,
    AppConnectionValueForAuthProperty,
    TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import dayjs from 'dayjs';
import { timelinesAiAuth, timelinesAiCommon } from '../common';

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof timelinesAiAuth>,
  Record<string, never>
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth: apiKey, propsValue, lastFetchEpochMS }) => {
    const response = await timelinesAiCommon.getChats({
      apiKey: apiKey,
      closed: true,
    });
    const items = response.data.chats;
    return items.map((item) => ({
      epochMilliSeconds: dayjs(item.last_message_timestamp).valueOf(),
      data: item,
    }));
  },
};

export const chatClosed = createTrigger({
  auth: timelinesAiAuth,
  name: 'chatClosed',
  displayName: 'Chat Closed',
  description: 'Fires when a chat is closed.',
  aiMetadata: {
    description: 'Fires when a TimelinesAI WhatsApp chat is marked closed (resolved/archived). Polls for chats in the closed state and emits each newly closed conversation.',
  },
  props: {},
  sampleData: {
    id: 'chat_1a2b3c4d5e6f7g8h',
    name: 'Jane Doe',
    phone: '+15550100',
    jid: '15550100@s.whatsapp.net',
    is_group: false,
    closed: true,
    read: true,
    labels: ["support"],
    chatgpt_autoresponse_enabled: false,
    responsible_email: 'agent@acme.com',
    responsible_name: 'Support Agent',
    whatsapp_account_id: 'wa_9f8e7d6c5b4a4321',
    chat_url: 'https://app.timelines.ai/chats/chat_1a2b3c4d5e6f7g8h',
    created_timestamp: '2026-10-01 10:00:00',
    last_message_uid: 'msg_1a2b3c4d',
    last_message_timestamp: '2026-10-15 10:30:00',
    unattended: false,
    photo: 'https://app.timelines.ai/photos/chat_1a2b3c4d.jpg',
    group_members: [],
    is_allowed_to_message: true,
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
