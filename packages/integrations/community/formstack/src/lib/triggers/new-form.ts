
import { 
  createTrigger, 
  TriggerStrategy, 
  PiecePropValueSchema, 
  OAuth2PropertyValue, 
  AppConnectionValueForAuthProperty
} from '@inboxfm-connect/pieces-framework';
import { 
  DedupeStrategy, 
  Polling, 
  pollingHelper, 
  HttpMethod 
} from '@inboxfm-connect/pieces-common';
import dayjs from 'dayjs';
import { formStackAuth } from '../common/auth';
import { makeRequest } from '../common/client';

const polling: Polling<AppConnectionValueForAuthProperty<typeof formStackAuth>, any> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, propsValue, lastFetchEpochMS }) => {
    const authentication = auth as OAuth2PropertyValue;
    const accessToken = authentication['access_token'];

    try {
      const formsResponse = await makeRequest(
        accessToken,
        HttpMethod.GET,
        '/form.json'
      );

      const forms = formsResponse.forms || [];

      const newForms = forms.filter((form: any) => {
        if (!form.created) return false;
        
        const createdTime = dayjs(form.created, 'YYYY-MM-DD HH:mm:ss').valueOf();
        return createdTime > (lastFetchEpochMS ?? 0);
      });

      return newForms.map((form: any) => ({
        epochMilliSeconds: dayjs(form.created, 'YYYY-MM-DD HH:mm:ss').valueOf(),
        data: {
          id: form.id,
          name: form.name,
          views: parseInt(form.views) || 0,
          created: form.created,
          updated: form.updated,
          submissions: parseInt(form.submissions) || 0,
          submissions_unread: parseInt(form.submissions_unread) || 0,
          last_submission_id: form.last_submission_id,
          last_submission_time: form.last_submission_time,
          url: form.url,
          data_url: form.data_url,
          summary_url: form.summary_url,
          rss_url: form.rss_url,
          timezone: form.timezone,
          status: form.status,
          folder: form.folder,
          language: form.language,
          encrypted: form.encrypted,
          ssl: form.ssl,
          viewkey: form.viewkey,
        },
      }));
    } catch (error) {
      throw error;
    }
  }
};

export const newForm = createTrigger({
  auth: formStackAuth,
  name: 'newForm',
  displayName: 'New Form',
  description: 'Triggers when a new form is created',
  aiMetadata: {
    description: 'Fires when a new form is created in the connected Formstack account, emitting the form and its metadata. Polls the account form list and detects forms created since the last check.',
  },
  props: {},
  sampleData: {
    id: "6244510",
    name: "Customer Registration Form",
    views: 342,
    created: "2024-12-15 14:22:18",
    updated: "2024-12-20 09:45:33",
    submissions: 127,
    submissions_unread: 8,
    last_submission_id: "1361884054",
    last_submission_time: "2025-01-14 14:16:49",
    url: "https://activepieces.formstack.com/forms/customer_registration",
    data_url: "https://www.formstack.com/admin/form/summary/6244510",
    summary_url: "https://www.formstack.com/admin/form/data/6244510",
    rss_url: "https://www.formstack.com/forms/index.php?6244510-rss",
    timezone: "America/New_York",
    status: "1",
    folder: "Marketing Forms",
    language: "en",
    encrypted: "0",
    ssl: "1",
    viewkey: "K6244510MjPqRt"
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
