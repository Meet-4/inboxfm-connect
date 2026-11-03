import { AppConnectionValueForAuthProperty, OAuth2PropertyValue, Property, createTrigger } from '@inboxfm-connect/pieces-framework';
import { TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { leadConnectorAuth } from '../..';
import { getFormSubmissions, getForms } from '../common';

const polling: Polling<AppConnectionValueForAuthProperty<typeof leadConnectorAuth>, { form: string }> = {
  strategy: DedupeStrategy.LAST_ITEM,
  items: async ({ auth, propsValue }) => {
    const currentValues =
      (await getFormSubmissions(auth, propsValue.form)) ?? [];

    return currentValues.map((submission) => {
      return {
        id: submission.id,
        data: submission,
      };
    });
  },
};

export const newFormSubmission = createTrigger({
  auth: leadConnectorAuth,
  name: 'new_form_submission',
  displayName: 'New Form Submission',
  description: 'Trigger when a form is submitted.',
  aiMetadata: {
    description: 'Fires when a new submission is received for a specific GoHighLevel/LeadConnector form (selected by form ID). Represents the submitted form entry with its field values.',
  },
  props: {
    form: Property.Dropdown({
  auth: leadConnectorAuth,
      displayName: 'Form',
      description: 'The form you want to use.',
      required: true,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth)
          return {
            disabled: true,
            options: [],
          };

        const forms = await getForms(auth as OAuth2PropertyValue);

        return {
          options: forms.map((form) => {
            return {
              label: form.name,
              value: form.id,
            };
          }),
        };
      },
    }),
  },
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: '38303ec7-629a-49e2-888a-cf8bf0b1f97e',
    contactId: 'DWQ45t2IPVxi9LDu1wBl',
    createdAt: '2026-10-15T10:30:00.000Z',
    formId: 'YSWdvS4Is98wtIDGnpmI',
    name: 'test',
    email: 'test@test.com',
  },

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
});

