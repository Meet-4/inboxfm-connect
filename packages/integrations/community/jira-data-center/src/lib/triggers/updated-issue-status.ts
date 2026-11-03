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
		const searchQuery = `${jql ? jql + ' AND ' : ''}status CHANGED AFTER '${dayjs(
			lastFetchEpochMS,
		).format('YYYY-MM-DD HH:mm')}'`;
		const issues = await searchIssuesByJql({
			auth,
			jql: searchQuery,
			maxResults: 50,
		});
		return issues.map((issue) => ({
			epochMilliSeconds: Date.parse(issue.fields.updated),
			data: issue,
		}));
	},
};

export const updatedIssueStatus = createTrigger({
	name: 'updated_issue_status',
	displayName: 'Updated Issue Status',
	description: 'Triggers when an issue status is updated',
	aiMetadata: {
		description:
			'Fires specifically when an issue\'s status (workflow state) changes in Jira Data Center/Server — narrower than Updated Issue, which fires on any field change. Uses JQL "status CHANGED" polling; an optional JQL filter further narrows which issues are watched.',
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
				name: 'Done',
				id: '10002',
				description: 'Work has finished on the issue',
				statusCategory: {
					name: 'Done',
					id: 3,
					key: 'done',
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

