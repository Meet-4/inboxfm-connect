import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { zohoDeskPaginatedApiCall } from '../common';
import { zohoDeskAuth } from '../common/auth';
import { organizationId } from '../common/props';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { isNil } from '@inboxfm-connect/pieces-framework';

export const findContactAction = createAction({
	auth: zohoDeskAuth,
	name: 'find-contact',
	displayName: 'Find Contact',
	description: 'Finds an existing contact by email.',
	audience: 'both',
	aiMetadata: { description: 'Searches a Zoho Desk organization for contacts matching an exact email address, returning whether any were found along with the matches (follows Zoho Desk pagination, up to 1000 matches). Use to resolve a contact (e.g. before creating or routing a ticket) when you have the email rather than an ID; requires the organization ID and email. Read-only and idempotent.', idempotent: true },
	props: {
		orgId: organizationId({ displayName: 'Organization', required: true }),
		email: Property.ShortText({
			displayName: 'Email',
			required: true,
		}),
	},
	async run(context) {
		const contacts = await zohoDeskPaginatedApiCall({
			auth: context.auth,
			method: HttpMethod.GET,
			resourceUri: '/contacts/search',
			orgId: context.propsValue.orgId,
			query: {
				email: context.propsValue.email,
			},
		});

		if (isNil(contacts) || contacts.length === 0) {
			return {
				found: false,
				result: [],
			};
		}

		return {
			found: contacts.length > 0,
			result: contacts,
		};
	},
});
