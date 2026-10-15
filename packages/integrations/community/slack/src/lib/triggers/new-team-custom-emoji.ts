import { TriggerStrategy, createTrigger } from '@inboxfm-connect/pieces-framework';
import { slackAuth } from '../auth';
import { WebClient } from '@slack/web-api';
import { getBotToken, getTeamId, SlackAuthValue } from '../common/auth-helpers';

const sampleData = {
	id: 'heart',
	image: 'https://emoji.slack-edge.com/T06BTHUEFFF/heart/84a171ae62daacc7.jpg',
};

export const newTeamCustomEmojiTrigger = createTrigger({
	auth: slackAuth,
	name: 'new-team-custom-emoji',
	displayName: 'New Team Custom Emoji',
	description: 'Triggers when a custom emoji has been added to a team.',
	aiMetadata: {
		description:
			'Fires when a new custom emoji is added to the Slack workspace (an emoji_changed event with the "add" subtype). The event payload includes the emoji id (name) and the image URL of the added emoji.',
	},
	props: {},
	type: TriggerStrategy.APP_WEBHOOK,
	sampleData,
	onEnable: async (context) => {
		const teamId = await getTeamId(context.auth as SlackAuthValue);
		context.app.createListeners({
			events: ['emoji_changed'],
			identifierValue: teamId,
		});
	},
	onDisable: async (context) => {
		// Ignored
	},

	test: async (context) => {
		const client = new WebClient(getBotToken(context.auth as SlackAuthValue));

		const response = await client.emoji.list();

		if (!response.emoji) return [sampleData];

		return Object.entries(response.emoji).map(([id, image]) => ({
			id,
			image,
		}));
	},

	run: async (context) => {
		const payloadBody = context.payload.body as PayloadBody;

		// Only additions carry name/value; remove events use a `names` array and
		// renames use old_name/new_name (https://api.slack.com/events/emoji_changed).
		if (payloadBody.event.type !== 'emoji_changed' || payloadBody.event.subtype !== 'add') {
			return [];
		}

		return [{ id: payloadBody.event.name, image: payloadBody.event.value }];
	},
});

type PayloadBody = {
	event: {
		type: string;
		subtype: string;
		name: string;
		value: string;
	};
};
