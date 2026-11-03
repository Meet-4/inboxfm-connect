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
    const response = await timelinesAiCommon.listUploadedFiles({
      apiKey,
    });
    const items = response.data;
    return items.map((item) => ({
      epochMilliSeconds: dayjs(item.uploaded_at).valueOf(),
      data: item,
    }));
  },
};

export const newUploadedFile = createTrigger({
  auth: timelinesAiAuth,
  name: 'newUploadedFile',
  displayName: 'New Uploaded File',
  description: 'Fires when a new file is uploaded in a chat.',
  aiMetadata: {
    description: 'Fires when a new file is uploaded to TimelinesAI. Polls the uploaded-files list and emits each newly added file as it appears.',
  },
  props: {},
  sampleData: {
    temporary_download_url: 'https://app.timelines.ai/files/tmp/1a2b3c4d5e6f.pdf',
    uid: 'file_1a2b3c4d5e6f7g8h',
    filename: 'invoice-october.pdf',
    size: 102400,
    mimetype: 'application/pdf',
    uploaded_by_email: 'agent@acme.com',
    uploaded_at: '2026-10-15 10:30:00',
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
