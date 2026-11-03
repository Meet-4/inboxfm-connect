import {
  Property,
  TriggerStrategy,
  createTrigger,
} from '@inboxfm-connect/pieces-framework';
import {
  Polling,
  DedupeStrategy,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { JiraAuth, jiraCloudAuth } from '../../auth';
import { searchIssuesByJql } from '../common';
import dayjs from 'dayjs';

const polling: Polling<
  JiraAuth,
  { jql?: string; sanitizeJql?: boolean }
> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, lastFetchEpochMS, propsValue }) => {
    const { jql, sanitizeJql } = propsValue;
    const searchQuery = `${jql ? jql + ' AND ' : ''}created > '${dayjs(
      lastFetchEpochMS
    ).format('YYYY-MM-DD HH:mm')}'`;
    const response = await searchIssuesByJql({
      auth,
      jql: searchQuery,
      maxResults: 50,
      sanitizeJql: sanitizeJql ?? false,
    });
    return response.issues.map((issue: any) => ({
      epochMilliSeconds: Date.parse(issue.fields.created),
      data: issue,
    }));
  },
};

export const newIssue = createTrigger({
  name: 'new_issue',
  displayName: 'New Issue',
  description: 'Triggers when a new issue is created',
  aiMetadata: {
    description:
      'Fires when a new Jira issue is created, optionally limited to issues matching a JQL filter. Each event represents one newly created issue with its full field data (summary, project, type, status, reporter, etc.). Polling-based; events arrive on the next poll, not instantly.',
  },
  auth: jiraCloudAuth,
  type: TriggerStrategy.POLLING,
  props: {
    jql: Property.LongText({
      displayName: 'JQL',
      description: 'Use to filter issues watched',
      required: false,
    }),
    sanitizeJql: Property.Checkbox({
      displayName: 'Sanitize JQL',
      required: false,
      defaultValue: true,
    }),
  },
  sampleData: {
    id: '10042',
    key: 'PROJ-42',
    fields: {
      summary: 'Payment reconciliation fails for multi-currency invoices',
      created: '2026-10-15T10:20:00.000+0000',
      updated: '2026-10-15T10:30:00.000+0000',
      statuscategorychangedate: '2026-10-15T10:30:00.000+0000',
      status: {
        name: 'In Progress',
        id: '3',
        description: 'This issue is being actively worked on at the moment by the assignee.',
        statusCategory: {
          name: 'In Progress',
          id: 4,
          key: 'indeterminate',
        },
      },
      issuetype: {
        name: 'Story',
        id: '10001',
        subtask: false,
      },
      project: {
        id: '10000',
        key: 'PROJ',
        name: 'Payments',
      },
      priority: {
        name: 'High',
        id: '2',
      },
      assignee: {
        accountId: '5f8c1a2b3c4d5e6f7a8b9c0d',
        displayName: 'Jane Doe',
        emailAddress: 'jane.doe@example.com',
        active: true,
      },
      reporter: {
        accountId: '5f8c1a2b3c4d5e6f7a8b9c0e',
        displayName: 'Bob Dullan',
        emailAddress: 'bob@example.com',
        active: true,
      },
    },
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
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
});

