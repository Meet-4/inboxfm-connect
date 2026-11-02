import { DynamicPropsValue, DropdownOption, Property } from '@inboxfm-connect/pieces-framework';
import MailerLite from '@mailerlite/mailerlite-nodejs';
import { mailerLiteAuth } from '../..';

// MailerLite paginates GET /api/groups with page/limit (an account can have
// at most 1000 groups). A single page=1&limit=100 request silently dropped
// every group past the first 100, so walk the documented page contract
// (meta.last_page / links.next) with a bounded budget and surface a
// truncation notice.
// https://developers.mailerlite.com/docs/groups
const MAILERLITE_GROUP_PAGE_SIZE = 100;
const MAILERLITE_GROUP_MAX_PAGES = 10;

async function fetchAllMailerLiteGroups(
	client: MailerLite
): Promise<{
	groups: { label: string; value: string }[];
	truncated: boolean;
}> {
	const options: { label: string; value: string }[] = [];
	let truncated = false;
	let page = 1;

	while (page <= MAILERLITE_GROUP_MAX_PAGES) {
		const response = await client.groups.get({
			page,
			limit: MAILERLITE_GROUP_PAGE_SIZE,
			sort: '-created_at',
		});

		for (const group of response.data.data) {
			options.push({
				label: group.name,
				value: group.id,
			});
		}

		if (page >= response.data.meta.last_page) {
			break;
		}
		if (page === MAILERLITE_GROUP_MAX_PAGES) {
			truncated = true;
			break;
		}
		page++;
	}

	return { groups: options, truncated };
}

export const mailerLiteCommon = {
	subscriberFields: Property.DynamicProperties({
		auth: mailerLiteAuth,
		displayName: 'Fields',
		refreshers: [],
		required: true,
		props: async ({ auth }) => {
			if (!auth) return {};

			const props: DynamicPropsValue = {};

			const client = new MailerLite({ api_key: auth.secret_text });
			const response = await client.fields.get({ page: 1, limit: 100 });

			for (const field of response.data.data) {
				switch (field.type) {
					case 'number':
						props[field.key] = Property.Number({
							displayName: field.name,
							required: false,
						});
						break;
					case 'text':
						props[field.key] = Property.LongText({
							displayName: field.name,
							required: false,
						});
						break;
					case 'date':
						props[field.key] = Property.DateTime({
							displayName: field.name,
							required: false,
							description: 'Provide YYYY-MM-DD format.',
						});
						break;
				}
			}
			return props;
		},
	}),
	subscriberGroupIds: (required = false) =>
		Property.MultiSelectDropdown({
			auth: mailerLiteAuth,
			displayName: 'Group IDs',
			required,
			refreshers: [],
			options: async ({ auth }) => {
				if (!auth) {
					return {
						disabled: true,
						placeholder: 'Please connect your account first.',
						options: [],
					};
				}

				const client = new MailerLite({ api_key: auth.secret_text });
				const { groups, truncated } = await fetchAllMailerLiteGroups(client);
				const options: DropdownOption<string>[] = groups;

				if (truncated) {
					options.push({
						label: '⚠️ Could not load all groups (partial list)',
						value: '__truncated_notice__',
					});
				}

				return {
					disabled: false,
					options,
				};
			},
		}),
	subscriberGroupId: (required = false) =>
		Property.Dropdown({
			auth: mailerLiteAuth,
			displayName: 'Group ID',
			required,
			refreshers: [],
			options: async ({ auth }) => {
				if (!auth) {
					return {
						disabled: true,
						placeholder: 'Please connect your account first.',
						options: [],
					};
				}

				const client = new MailerLite({ api_key: auth.secret_text });
				const { groups, truncated } = await fetchAllMailerLiteGroups(client);
				const options: DropdownOption<string>[] = groups;

				if (truncated) {
					options.push({
						label: '⚠️ Could not load all groups (partial list)',
						value: '__truncated_notice__',
					});
				}

				return {
					disabled: false,
					options,
				};
			},
		}),
	subscriberId: (required = false) =>
		Property.Dropdown({
			auth: mailerLiteAuth,
			displayName: 'Subscriber ID',
			refreshers: [],
			required,
			options: async ({ auth }) => {
				if (!auth) {
					return {
						disabled: true,
						placeholder: 'Please connect your account first.',
						options: [],
					};
				}
				const client = new MailerLite({ api_key: auth.secret_text });
				const subscribers: { label: string; value: string }[] = [];
				let cursor;
				do {
					const response = await client.subscribers.get({
						limit: 25,
						cursor: cursor,
					});
					subscribers.push(
						...response.data.data.map((subscriber) => ({
							label: subscriber.email,
							value: subscriber.id,
						})),
					);
					cursor = response.data.meta.next_cursor;
				} while (cursor !== null);
				return {
					disabled: false,
					options: subscribers,
				};
			},
		}),
};

