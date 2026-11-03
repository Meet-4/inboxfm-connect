import {
  AppConnectionValueForAuthProperty,
  createTrigger,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import {
  DedupeStrategy,
  HttpMethod,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { lokaliseAuth } from '../common/auth';
import { projectDropdown } from '../common/props';
import { makeRequest } from '../common/client';

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof lokaliseAuth>,
  { projectId: string }
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, propsValue, lastFetchEpochMS }) => {
    const translations = (await makeRequest(
      auth.secret_text,
      HttpMethod.GET,
      `/projects/${propsValue.projectId}/translations`
    )) as any;

    return translations.translations
      .filter(
        (translation: { modified_at_timestamp: number }) =>
          translation.modified_at_timestamp * 1000 > lastFetchEpochMS
      )
      .map((translation: any) => ({
        epochMilliSeconds: translation.modified_at_timestamp * 1000,
        data: translation,
      }));
  },
};

export const translationUpdated = createTrigger({
  auth: lokaliseAuth,
  name: 'translationUpdated',
  displayName: 'Translation Updated',
  description: 'Trigger when a translation is updated in your Lokalise project',
  aiMetadata: {
    description: 'Fires when a translation is modified in the selected Lokalise project, emitting that translation. Polls the project translations list and detects changes by modification timestamp.',
  },
  props: {
    projectId: projectDropdown,
  },
  sampleData: {
    translation_id: 345678,
    key_id: 123456,
    language_iso: 'de',
    modified_at: '2026-10-15 10:30:00 (Etc/UTC)',
    modified_at_timestamp: 1762000000,
    modified_by: 201,
    modified_by_email: 'jane.doe@example.com',
    translation: 'Willkommen',
    is_unverified: false,
    is_reviewed: true,
    reviewed_by: 201,
    words: 1,
    custom_translation_statuses: [],
    task_id: null,
    segment_number: 1,
  },
  type: TriggerStrategy.POLLING,
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

