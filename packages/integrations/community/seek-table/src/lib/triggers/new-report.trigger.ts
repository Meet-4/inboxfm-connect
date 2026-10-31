import {
  DedupeStrategy,
  HttpMethod,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import {
  AppConnectionValueForAuthProperty,
  TriggerStrategy,
  createTrigger,
} from '@inboxfm-connect/pieces-framework';
import { seekTableAuth } from '../../lib/common/auth';
import { seekTableApiCall } from '../../lib/common/client';

interface Report {
  Id: string;
  Name: string;
  ReportType: string;
  Config: string;
  CreateDate?: string;
}

const SEEN_REPORT_IDS_KEY = 'seen_report_ids';

const polling: Polling<AppConnectionValueForAuthProperty<typeof seekTableAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
    const response = await seekTableApiCall({
      auth: auth.secret_text,
      method: HttpMethod.GET,
      resourceUri: 'api/report',
    }) as Report[];

    // Reports without a CreateDate used to be re-emitted on every poll
    // because their epoch always landed after the cursor. Dedupe by id so
    // each report is emitted at most once; reports WITH a CreateDate keep
    // the cursor-based filtering from pollingHelper on top of this check.
    const isTest = lastFetchEpochMS === 0;
    const seenIds = new Set<string>(
      (await store.get<string[]>(SEEN_REPORT_IDS_KEY)) ?? []
    );
    const newReports = isTest
      ? response
      : response.filter((report) => !seenIds.has(report.Id));
    if (!isTest && response.length > 0) {
      await store.put(
        SEEN_REPORT_IDS_KEY,
        response.map((report) => report.Id)
      );
    }

    return newReports.map((report) => ({
      epochMilliSeconds: report.CreateDate ? Date.parse(report.CreateDate) : Date.now(),
      data: report,
    }));
  },
};

export const newReportTrigger = createTrigger({
  auth: seekTableAuth,
  name: 'new_report',
  displayName: 'New Report',
  description: 'Triggers when a new report is added to your SeekTable account.',
  aiMetadata: {
    description: 'Fires when a new report appears in the connected SeekTable account. Polls the report list and emits one event per newly created report, representing a report definition that is now available to run or share.',
  },
  type: TriggerStrategy.POLLING,
  props: {},
  sampleData: {
    Id: "edb1ee25d81c4acd96d2c9d0f819afde",
    Name: "Total by Year",
    ReportType: "pivot",
    Config: "{report_JSON_config}"
  },
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
  async onEnable(context) {
    // Baseline existing reports as seen so the first poll only emits reports
    // created after the trigger is enabled (no first-poll flood).
    const existingReports = await seekTableApiCall({
      auth: context.auth.secret_text,
      method: HttpMethod.GET,
      resourceUri: 'api/report',
    }) as Report[];
    if (Array.isArray(existingReports) && existingReports.length > 0) {
      await context.store.put(
        SEEN_REPORT_IDS_KEY,
        existingReports.map((report) => report.Id)
      );
    }
    await pollingHelper.onEnable(polling, context);
  },
  async onDisable(context) {
    await pollingHelper.onDisable(polling, context);
  },
  async run(context) {
    return await pollingHelper.poll(polling, context);
  },
});
