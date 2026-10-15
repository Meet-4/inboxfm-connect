import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { zohoDeskAuth } from '../common/auth';
import { zohoDeskApiCall } from '../common';
import { organizationId } from '../common/props';

export const listTicketsAction = createAction({
	auth: zohoDeskAuth,
	name: 'list_tickets',
	description: 'List tickets. Returns one page of up to 100 tickets; use From to page through the rest.',
	audience: 'both',
	aiMetadata: { description: 'Retrieves one page of tickets from a Zoho Desk organization (up to 100 per call, starting at the From index), optionally expanding related data (contacts, products, departments, team, isRead, assignee) via the include option. Page through results by advancing From when the previous page was full; requires the organization ID. Read-only and idempotent.', idempotent: true },
	displayName: 'List tickets.',
	props: {
		orgId: organizationId({ displayName: 'Organization', required: true }),
		from: Property.Number({
			displayName: 'From',
			description: 'Index number (0-based) from which tickets should be fetched. Defaults to 0.',
			required: false,
		}),
		limit: Property.Number({
			displayName: 'Limit',
			description: 'Number of tickets to fetch (1-100). Defaults to 100.',
			required: false,
		}),
		include: Property.StaticMultiSelectDropdown({
			displayName: 'include',
			required: false,
			description: 'Additional information related to the tickets.',
			options: {
				disabled: false,
				options: [
					{ label: 'contacts', value: 'contacts' },
					{ label: 'products', value: 'products' },
					{ label: 'departments', value: 'departments' },
					{ label: 'team', value: 'team' },
					{ label: 'isRead', value: 'isRead' },
					{ label: 'assignee', value: 'assignee' },
				],
			},
		}),
	},
	async run({ propsValue, auth }) {
		// GET /tickets is paginated: from (index, 0-based) and limit (1-100)
		// — desk.zoho.com/DeskAPIDocument. The old code sent no paging
		// params at all, silently returning only the API's small default
		// page with no way to reach the rest.
		const queryParams: Record<string, string> = {};

		if (propsValue.include) queryParams['include'] = propsValue.include.join(',');
		if (propsValue.from !== undefined && propsValue.from !== null) {
			queryParams['from'] = String(Math.max(propsValue.from, 0));
		}
		queryParams['limit'] = String(
			Math.min(Math.max(propsValue.limit ?? 100, 1), 100)
		);

		const response = await zohoDeskApiCall({
			auth,
			method: HttpMethod.GET,
			resourceUri: '/tickets',
			orgId: propsValue.orgId,
			query: queryParams,
		});

		return response;
	},
});
