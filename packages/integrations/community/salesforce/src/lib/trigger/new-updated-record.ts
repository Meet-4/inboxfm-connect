import {
  DedupeStrategy,
  HttpMethod,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
  AppConnectionValueForAuthProperty,
  Property,
  TriggerStrategy,
  createTrigger,
} from '@inboxfm-connect/pieces-framework';
import { querySalesforceApi, salesforcesCommon } from '../common';

import dayjs from 'dayjs';
import { salesforceAuth } from '../..';

export const newOrUpdatedRecord = createTrigger({
  auth: salesforceAuth,
  name: 'new_or_updated_record',
  displayName: 'New or Updated Record',
  description: 'Triggers when there is new or updated record',
  aiMetadata: {
    description: 'Fires whenever a record of the selected Salesforce object is created or updated, detected by polling for records whose LastModifiedDate is later than the last poll. Each event emits all fields of the changed record. An optional SOQL where-clause condition can further filter which records trigger the event.',
  },
  props: {
    object: salesforcesCommon.object,
    conditions: Property.LongText({
      displayName: 'Conditions (Advanced)',
      description: 'Enter a SOQL query where clause i. e. IsDeleted = TRUE',
      required: false,
    }),
  },
  sampleData: {
    attributes: {
      type: 'Lead',
      url: 'https://acme-dev-ed.my.salesforce.com/services/data/v59.0/sobjects/Lead/00Qxx000000000123',
    },
    Id: '00Qxx000000000123',
    IsDeleted: false,
    FirstName: 'Jane',
    LastName: 'Doe',
    Company: 'Acme Corp',
    Email: 'jane.doe@example.com',
    Phone: '+15550100',
    Status: 'Working - Contacted',
    CreatedDate: '2026-10-15T10:30:00.000+0000',
    LastModifiedDate: '2026-10-15T10:45:00.000+0000',
    SystemModstamp: '2026-10-15T10:45:00.000+0000',
  },
  type: TriggerStrategy.POLLING,
  async test(ctx) {
    return await pollingHelper.test(polling, {
      auth: ctx.auth,
      store: ctx.store,
      propsValue: ctx.propsValue,
      files: ctx.files,
    });
  },
  async onEnable(ctx) {
    await pollingHelper.onEnable(polling, {
      auth: ctx.auth,
      store: ctx.store,
      propsValue: ctx.propsValue,
    });
  },
  async onDisable(ctx) {
    await pollingHelper.onDisable(polling, {
      auth: ctx.auth,
      store: ctx.store,
      propsValue: ctx.propsValue,
    });
  },
  async run(ctx) {
    return await pollingHelper.poll(polling, ctx);
  },
});

const polling: Polling<
  AppConnectionValueForAuthProperty<typeof salesforceAuth>,
  { object: string | undefined; conditions: string | undefined }
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, propsValue, lastFetchEpochMS }) => {
    const items = await getRecords(
      auth,
      propsValue.object!,
      dayjs(lastFetchEpochMS).toISOString(),
      propsValue.conditions
    );
    return items.map((item) => ({
      epochMilliSeconds: dayjs(item.LastModifiedDate).valueOf(),
      data: item,
    }));
  },
};

const getRecords = async (
  authentication: AppConnectionValueForAuthProperty<typeof salesforceAuth>,
  object: string,
  startDate: string,
  conditions: string | undefined
) => {
  const response = await querySalesforceApi<{
    records: { LastModifiedDate: string }[];
  }>(
    HttpMethod.GET,
    authentication,
    constructQuery(object, 200, 0, startDate, conditions)
  );
  return response.body['records'];
};

function constructQuery(
  object: string,
  limit: number,
  offset: number,
  startDate: string,
  conditions: string | undefined
) {
  return `
    SELECT
      FIELDS(ALL)
    FROM
      ${object}
    WHERE LastModifiedDate > ${startDate} ${
    conditions != undefined ? `AND ${conditions}` : ''
  }
    ORDER BY LastModifiedDate ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}
