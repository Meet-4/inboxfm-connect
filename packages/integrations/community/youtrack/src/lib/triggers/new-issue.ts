// Trigger: New Issue
import { AppConnectionValueForAuthProperty, createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, HttpMethod, Polling, pollingHelper } from '@inboxfm-connect/pieces-common';
import { youtrackAuth } from '../../';
import { ISSUE_FIELDS, flattenObject, youtrackApiCall } from '../common';

const polling: Polling<AppConnectionValueForAuthProperty<typeof youtrackAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, lastFetchEpochMS }) => {
    // YouTrack's search language has no `{after <epoch>}` form: the raw
    // epoch-ms value in braces is not a documented date value (documented
    // syntax is `created: <date> .. <date>` with YYYY-MM-DD[THH:MM:SS]
    // dates), so the old fragment never filtered anything server-side.
    // Use the documented open range instead. Query dates are interpreted
    // in the querying user's timezone, so widen the lower bound by 24h and
    // let the epoch-ms dedupe in pollingHelper drop the over-fetched
    // issues.
    const since = new Date(lastFetchEpochMS - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19);
    const response = await youtrackApiCall<Array<Record<string, unknown>>>({
      baseUrl: auth.props.baseUrl,
      token: auth.props.apiToken,
      method: HttpMethod.GET,
      path: '/issues',
      queryParams: {
        fields: ISSUE_FIELDS,
        query: 'created: ' + since + ' .. *',
        '$top': '50',
      },
    });
    return (response.body || []).map((issue) => ({
      epochMilliSeconds: (issue['created'] as number) || 0,
      data: flattenObject(issue),
    }));
  },
};

export const newIssueTrigger = createTrigger({
  auth: youtrackAuth,
  name: 'new_issue',
  displayName: 'New Issue',
  description: 'Triggers when a new issue is created in any project you can access.',
  aiMetadata: {
    description: 'Fires when a new issue is created in any YouTrack project the connected account can access. Each event represents one newly created issue with its summary, project, reporter, and field values.',
  },
  props: {},
  sampleData: {
    idReadable: 'SP-42', summary: 'Fix login page crash', project_name: 'Sample Project',
    project_shortName: 'SP', reporter_name: 'Jane Doe', commentsCount: 0,
    created: 1644916724088, updated: 1644916724088,
  },
  type: TriggerStrategy.POLLING,
  async test(context) { return await pollingHelper.test(polling, context); },
  async onEnable(context) { await pollingHelper.onEnable(polling, context); },
  async onDisable(context) { await pollingHelper.onDisable(polling, context); },
  async run(context) { return await pollingHelper.poll(polling, context); },
});
