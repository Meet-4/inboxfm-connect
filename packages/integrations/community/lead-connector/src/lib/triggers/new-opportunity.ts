import { AppConnectionValueForAuthProperty, OAuth2PropertyValue, Property, createTrigger } from '@inboxfm-connect/pieces-framework';
import { TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { leadConnectorAuth } from '../..';
import { getOpportunities, getPipelines } from '../common';

const polling: Polling<AppConnectionValueForAuthProperty<typeof leadConnectorAuth>, { pipeline: string }> = {
  strategy: DedupeStrategy.LAST_ITEM,
  items: async ({ auth, propsValue, lastItemId }) => {
    const currentValues =
      (await getOpportunities(auth, propsValue.pipeline, {
        startAfterId: lastItemId as string | undefined,
      })) ?? [];

    return currentValues.map((opportunity: any) => {
      return {
        id: opportunity.id,
        data: opportunity,
      };
    });
  },
};

export const newOpportunity = createTrigger({
  auth: leadConnectorAuth,
  name: 'new_opportunity',
  displayName: 'New Opportunity',
  description: 'Trigger when a new opportunity is added.',
  aiMetadata: {
    description: 'Fires when a new opportunity is created in a specific GoHighLevel/LeadConnector pipeline (selected by pipeline ID). Represents the newly created opportunity; scoped to the chosen pipeline only.',
  },
  props: {
    pipeline: Property.Dropdown({
  auth: leadConnectorAuth,
      displayName: 'Pipeline',
      description: 'The ID of the pipeline to use.',
      required: true,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            options: [],
          };
        }

        const pipelines = await getPipelines(auth as OAuth2PropertyValue);
        return {
          options: pipelines.map((pipeline: any) => {
            return {
              label: pipeline.name,
              value: pipeline.id,
            };
          }),
        };
      },
    }),
  },
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: 'op9Kd3fT2xQpL',
    name: 'Acme renewal',
    pipelineId: 'pipeline01',
    pipelineStageId: 'stage02',
    contactId: 'DWQ45t2IPVxi9LDu1wBl',
    status: 'open',
    monetaryValue: 1500,
    assignedTo: 'FFIlZv9yV8nW4b05UR3l',
    createdAt: '2026-10-15T10:30:00.000Z',
    updatedAt: '2026-10-15T10:30:00.000Z',
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

