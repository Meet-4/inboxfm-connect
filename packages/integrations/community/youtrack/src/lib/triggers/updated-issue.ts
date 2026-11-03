// Trigger: Updated Issue
import { AppConnectionValueForAuthProperty, createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, HttpMethod, Polling, pollingHelper } from '@inboxfm-connect/pieces-common';
import { youtrackAuth } from '../../';
import { ISSUE_FIELDS, flattenObject, youtrackApiCall } from '../common';

const polling: Polling<AppConnectionValueForAuthProperty<typeof youtrackAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, lastFetchEpochMS }) => {
    // YouTrack's search language has no `{after <epoch>}` / `{before
    // <epoch>}` form: raw epoch-ms values in braces are not documented date
    // values (documented syntax is `updated: <date> .. *` ranges with
    // YYYY-MM-DD[THH:MM:SS] dates), so those fragments never filtered
    // anything server-side. Use the documented open range instead, widened
    // by 24h because query dates are interpreted in the querying user's
    // timezone — the epoch-ms dedupe in pollingHelper drops the
    // over-fetched issues.
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
        query: 'updated: ' + since + ' .. *',
        '$top': '50',
      },
    });
    return (response.body || [])
      // The old query tried to exclude issues created after the last poll
      // (`created: {before <epoch>}`) so brand-new issues only fire the New
      // Issue trigger. Keep that split client-side; test mode
      // (lastFetchEpochMS === 0) still shows sample issues.
      .filter(
        (issue) =>
          lastFetchEpochMS === 0 ||
          ((issue['created'] as number) ?? 0) <= lastFetchEpochMS
      )
      .map((issue) => ({
        epochMilliSeconds:
          (issue['updated'] as number) || (issue['created'] as number) || 0,
        data: flattenObject(issue),
      }));
  },
};

export const updatedIssueTrigger = createTrigger({
  auth: youtrackAuth,
  name: 'updated_issue',
  displayName: 'Updated Issue',
  description: 'Triggers when an existing issue is modified (summary, description, custom fields, etc.).',
  aiMetadata: {
    description: 'Fires when an existing issue is modified — its summary, description, custom fields, or other attributes change. Each event represents one updated issue (issues created within the same polling window are excluded). Use to react to changes on already-existing issues rather than brand-new ones.',
  },
  props: {},
  sampleData: {
    idReadable: 'SP-42', summary: 'Fixed login page crash', project_name: 'Sample Project',
    project_shortName: 'SP', reporter_name: 'Jane Doe', commentsCount: 3,
    created: 1644916724088, updated: 1648110830229,
  },
  type: TriggerStrategy.POLLING,
  async test(context) { return await pollingHelper.test(polling, context); },
  async onEnable(context) { await pollingHelper.onEnable(polling, context); },
  async onDisable(context) { await pollingHelper.onDisable(polling, context); },
  async run(context) { return await pollingHelper.poll(polling, context); },
});
