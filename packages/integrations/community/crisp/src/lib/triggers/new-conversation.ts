import {
	createTrigger,
	TriggerStrategy,
	AppConnectionValueForAuthProperty,
} from '@inboxfm-connect/pieces-framework';
import { crispAuth } from '../common/auth';
import { websiteIdProp } from '../common/props';
import {
	DedupeStrategy,
	HttpMethod,
	Polling,
	pollingHelper,
	QueryParams,
} from '@inboxfm-connect/pieces-common';
import dayjs from 'dayjs';
import { crispApiCall } from '../common/client';

const polling: Polling<AppConnectionValueForAuthProperty<typeof crispAuth>, { websiteId: string }> = {
	strategy: DedupeStrategy.TIMEBASED,
	async items({ auth, lastFetchEpochMS, propsValue }) {
		const websiteId = propsValue.websiteId;

		let page = 1;
		let hasMoreItems = false;
		const conversations = [];
		do {
			const qs: QueryParams = {
				per_page: '50',
			};
			if (lastFetchEpochMS) {
				qs['filter_date_start'] = dayjs(lastFetchEpochMS).toString();
			}

			const response = await crispApiCall<{ data: { created_at: number }[] }>({
				auth,
				method: HttpMethod.GET,
				resourceUri: `/website/${websiteId}/conversations/${page}`,
				query: qs,
			});

			const items = response.data || [];
			conversations.push(...items);

			page++;
			hasMoreItems = items.length > 0;

			if (lastFetchEpochMS === 0) break;
		} while (hasMoreItems);

		return conversations.map((conv) => ({
			epochMilliSeconds: conv.created_at,
			data: conv,
		}));
	},
};

export const newConversationTrigger = createTrigger({
	auth: crispAuth,
	name: 'new_conversation',
	displayName: 'New Conversation Created',
	description: 'Triggers when a new conversation is started.',
	aiMetadata: {
		description: 'Fires when a new conversation is started in the selected Crisp website inbox. Polls the conversations list on a schedule and emits each newly created conversation.',
	},
	props: {
		websiteId: websiteIdProp,
	},
	type: TriggerStrategy.POLLING,
	sampleData: {
		session_id: 'session_9f8e7d6c-5b4a-4321-9876-dcba98765432',
		website_id: '8c840203-3f2b-4d6e-9f1a-2b3c4d5e6f7a',
		inbox_id: 'inbox_1a2b3c4d',
		people_id: 'c5a1b2d3-e4f5-6a7b-8c9d-0e1f2a3b4c5d',
		state: 'pending',
		active: 1,
		created_at: 1762000000,
		updated_at: 1762000100,
	},
	async onEnable(context) {
		await pollingHelper.onEnable(polling, {
			auth: context.auth,
			store: context.store,
			propsValue: context.propsValue,
		});
	},
	async onDisable(context) {
		await pollingHelper.onDisable(polling, {
			auth: context.auth,
			store: context.store,
			propsValue: context.propsValue,
		});
	},
	async test(context) {
		return await pollingHelper.test(polling, context);
	},
	async run(context) {
		return await pollingHelper.poll(polling, context);
	},
});

