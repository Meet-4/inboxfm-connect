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
import { JiraDataCenterAuth, jiraDataCenterAuth } from '../../auth';
import { searchIssuesByJql } from '../common';
import dayjs from 'dayjs';

const polling: Polling<
	JiraDataCenterAuth,
	{ jql?: string }
> = {
	strategy: DedupeStrategy.TIMEBASED,
	items: async ({ auth, lastFetchEpochMS, propsValue }) => {
		const { jql } = propsValue;
		const searchQuery = `${jql ? jql + ' AND ' : ''}created > '${dayjs(
			lastFetchEpochMS,
		).format('YYYY-MM-DD HH:mm')}'`;
		const issues = await searchIssuesByJql({
			auth,
			jql: searchQuery,
			maxResults: 50,
		});
		return issues.map((issue) => ({
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
			'Fires when a new issue is created in Jira Data Center/Server (polls for issues by creation time). An optional JQL filter narrows which issues are watched (e.g. a specific project or type); each newly created matching issue emits one event.',
	},
	auth: jiraDataCenterAuth,
	type: TriggerStrategy.POLLING,
	props: {
		jql: Property.LongText({
			displayName: 'JQL',
			description: 'Use to filter issues watched',
			required: false,
		}),
	},
	sampleData: {
		id: '10042',
		key: 'PROJ-42',
		fields: {
			summary: 'Payment reconciliation fails for multi-currency invoices',
			created: '2026-10-15T10:20:00.000+0000',
			updated: '2026-10-15T10:30:00.000+0000',
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
				name: 'jane.doe',
				key: 'jane.doe',
				displayName: 'Jane Doe',
				emailAddress: 'jane.doe@example.com',
				active: true,
			},
			reporter: {
				name: 'bob.dullan',
				key: 'bob.dullan',
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

