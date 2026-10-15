import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { attioAuth } from '../auth';
import { attioApiCall } from '../common/client';
import { linkedRecordDropdown, objectTypeIdDropdown } from '../common/props';

export const listTasksAction = createAction({
	auth: attioAuth,
	name: 'list_tasks',
	displayName: 'List Tasks',
	description: 'List tasks with optional filters by linked record, assignee, or completion status.',
	audience: 'both',
	aiMetadata: { description: 'Lists tasks in Attio, optionally narrowed by linked object type, linked record, assignee (member email/ID, or "null" for unassigned), and completion status. With no filters it returns all tasks. Use this to find tasks before getting or updating one. Read-only and idempotent.', idempotent: true },
	props: {
		linked_object: objectTypeIdDropdown({
			displayName: 'Linked Object',
			description: 'Filter tasks linked to records of this object type.',
			required: false,
		}),
		linked_record_id: linkedRecordDropdown({
			displayName: 'Linked Record',
			description: 'Filter tasks linked to this specific record.',
			required: false,
		}),
		assignee: Property.ShortText({
			displayName: 'Assignee',
			description:
				'Filter by workspace member email or ID. Enter "null" to find unassigned tasks.',
			required: false,
		}),
		is_completed: Property.StaticDropdown({
			displayName: 'Completion Status',
			required: false,
			options: {
				disabled: false,
				options: [
					{ label: 'All', value: 'all' },
					{ label: 'Completed', value: 'true' },
					{ label: 'Incomplete', value: 'false' },
				],
			},
		}),
	},
	async run(context) {
		const { linked_object, linked_record_id, assignee, is_completed } = context.propsValue;

		const TASKS_PAGE_SIZE = 500;

		const query: Record<string, string | number | undefined> = {
			limit: TASKS_PAGE_SIZE,
		};

		if (linked_object) query['linked_object'] = linked_object;
		if (linked_record_id) query['linked_record_id'] = linked_record_id;
		if (assignee) query['assignee'] = assignee;
		if (is_completed && is_completed !== 'all') query['is_completed'] = is_completed;

		const tasks: Array<Record<string, unknown>> = [];
		let offset = 0;

		// The action claims to return all tasks, but Attio caps one page at
		// 500 results, so keep walking pages until a short page comes back.
		while (true) {
			const response = await attioApiCall<{ data: Array<Record<string, unknown>> }>({
				accessToken: context.auth.secret_text,
				method: HttpMethod.GET,
				resourceUri: '/tasks',
				query: { ...query, offset },
			});

			const page: Array<Record<string, unknown>> = Array.isArray(response.data)
				? response.data
				: [];
			tasks.push(...page);

			if (page.length < TASKS_PAGE_SIZE) {
				break;
			}
			offset += page.length;
		}

		return {
			found: tasks.length > 0,
			result: tasks,
		};
	},
});

