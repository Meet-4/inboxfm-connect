import {
	AuthenticationType,
	HttpMethod,
	HttpMessageBody,
	HttpResponse,
	httpClient,
} from '@inboxfm-connect/pieces-common';
import { OAuth2PropertyValue, Property } from '@inboxfm-connect/pieces-framework';
import { salesforceAuth } from '../..';

// Salesforce returns up to 2,000 records per query batch and exposes
// `nextRecordsUrl` while `done` is false
// https://developer.salesforce.com/docs/platform/api-rest/guide/resources-query.html
const SALESFORCE_MAX_BATCHES = 3;

async function fetchAllSalesforceRecords<R>(
	authentication: OAuth2PropertyValue,
	query: string
): Promise<{ records: R[]; truncated: boolean }> {
	const records: R[] = [];
	let truncated = false;
	type QueryBatch = {
		records?: R[];
		done?: boolean;
		nextRecordsUrl?: string;
	};
	const first: HttpResponse<QueryBatch> = await querySalesforceApi<QueryBatch>(
		HttpMethod.GET,
		authentication,
		query
	);
	let response: HttpResponse<QueryBatch> = first;
	let batch = 0;
	while (batch < SALESFORCE_MAX_BATCHES) {
		batch++;
		records.push(...(response.body.records ?? []));
		if (response.body.done || !response.body.nextRecordsUrl) {
			break;
		}
		if (batch >= SALESFORCE_MAX_BATCHES) {
			truncated = true;
			break;
		}
		response = await callSalesforceApi<QueryBatch>(
			HttpMethod.GET,
			authentication,
			response.body.nextRecordsUrl,
			undefined
		);
	}
	return { records, truncated };
}

function withSalesforceTruncationWarning<
	T extends { label: string; value: string },
>(options: T[], truncated: boolean): T[] {
	if (truncated) {
		options.push({
			label: '⚠️ Could not load all records (partial list)',
			value: '__truncated_notice__',
		} as T);
	}
	return options;
}

export const salesforcesCommon = {
	account: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Account',
		required: false,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name FROM Account ORDER BY Name'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	object: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Object',
		required: true,
		description: 'Select the Object',
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'connect your account first',
					options: [],
				};
			}
			const options = await getSalesforceObjects(auth as OAuth2PropertyValue);
			return {
				disabled: false,
				options: options.body['sobjects']
					.map((object: any) => {
						return {
							label: object.label,
							value: object.name,
						};
					})
					.sort((a: { label: string }, b: { label: string }) =>
						a.label.localeCompare(b.label)
					)
					.filter((object: { label: string }) => !object.label.startsWith('_')),
			};
		},
	}),
	record: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Record',
		description: 'The record to select. Shows recently created records.',
		required: true,
		refreshers: ['object'],
		options: async ({ auth, object }) => {
			if (!auth || !object) {
				return {
					disabled: true,
					placeholder: 'Select an object first',
					options: [],
				};
			}

			try {
				const describeResponse = await getSalesforceFields(
					auth as OAuth2PropertyValue,
					object as string
				);
				const fields = describeResponse.body['fields'].map((f: any) => f.name);

				let displayField = 'Id';
				if (fields.includes('Name')) {
					displayField = 'Name';
				} else if (fields.includes('Subject')) {
					displayField = 'Subject';
				} else if (fields.includes('Title')) {
					displayField = 'Title';
				}

				const { records, truncated } = await fetchAllSalesforceRecords<{
					Id: string;
					[key: string]: any;
				}>(
					auth as OAuth2PropertyValue,
					`SELECT Id, ${displayField} FROM ${object} ORDER BY CreatedDate DESC`
				);

				return {
					disabled: false,
					options: withSalesforceTruncationWarning(
						records.map((record) => ({
							label: record[displayField] ?? record.Id,
							value: record.Id,
						})),
						truncated
					),
				};
			} catch (e) {
				console.error(e);
				const { records: fallbackRecords } =
					await fetchAllSalesforceRecords<{ Id: string }>(
						auth as OAuth2PropertyValue,
						`SELECT Id FROM ${object}`
					);
				return {
					disabled: false,
					options: fallbackRecords.map((record) => ({
						label: record.Id,
						value: record.Id,
					})),
				};
			}
		},
	}),
	recipient: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Recipient',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}

			const [contactsResult, leadsResult] = await Promise.all([
				fetchAllSalesforceRecords<{ Id: string; Name: string }>(
					auth as OAuth2PropertyValue,
					'SELECT Id, Name FROM Contact ORDER BY Name'
				),
				fetchAllSalesforceRecords<{ Id: string; Name: string }>(
					auth as OAuth2PropertyValue,
					'SELECT Id, Name FROM Lead ORDER BY Name'
				),
			]);

			const contactOptions = contactsResult.records.map((record) => ({
				label: `${record.Name} (Contact)`,
				value: record.Id,
			}));

			const leadOptions = leadsResult.records.map((record) => ({
				label: `${record.Name} (Lead)`,
				value: record.Id,
			}));

			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					[...contactOptions, ...leadOptions].sort((a, b) =>
						a.label.localeCompare(b.label)
					),
					contactsResult.truncated || leadsResult.truncated
				),
			};
		},
	}),
	field: Property.Dropdown<string, true, typeof salesforceAuth>({
		auth: salesforceAuth,
		displayName: 'Field',
		description: 'Select the Field',
		required: true,
		refreshers: ['object'],
		options: async ({ auth, object }) => {
			if (auth === undefined || !object) {
				return {
					disabled: true,
					placeholder: 'connect your account first',
					options: [],
				};
			}
			const options = await getSalesforceFields(
				auth as OAuth2PropertyValue,
				object as string
			);
			return {
				disabled: false,
				options: options.body['fields'].map((field: any) => {
					return {
						label: field.label,
						value: field.name,
					};
				}),
			};
		},
	}),
	campaign: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Campaign',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name FROM Campaign ORDER BY Name'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	contact: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Contact',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
				Email?: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name, Email FROM Contact ORDER BY Name'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Email
							? `${record.Name} — ${record.Email}`
							: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	lead: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Lead',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name FROM Lead ORDER BY Name'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	status: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Status',
		description: "The campaign member status (e.g., 'Sent', 'Responded').",
		required: true,
		refreshers: ['campaign_id'],
		options: async ({ auth, campaign_id }) => {
			if (!auth || !campaign_id) {
				return {
					disabled: true,
					placeholder: 'Select a campaign first',
					options: [],
				};
			}
			// Validate campaign_id to prevent SQL injection (Salesforce IDs are 15-18 alphanumeric characters)
			const campaignIdStr = String(campaign_id);
			if (!/^[a-zA-Z0-9]{15,18}$/.test(campaignIdStr)) {
				return {
					disabled: true,
					placeholder: 'Invalid campaign ID',
					options: [],
				};
			}
			const response = await querySalesforceApi<{
				records: { Label: string }[];
			}>(
				HttpMethod.GET,
				auth as OAuth2PropertyValue,
				`SELECT Label FROM CampaignMemberStatus WHERE CampaignId = '${campaignIdStr}'`
			);
			return {
				disabled: false,
				options: response.body.records.map((record) => ({
					label: record.Label,
					value: record.Label,
				})),
			};
		},
	}),
	leadSource: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Lead Source',
		required: false,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			try {
				const describeResponse = await getSalesforceFields(
					auth as OAuth2PropertyValue,
					'Lead'
				);
				const leadSourceField = describeResponse.body['fields'].find(
					(field: any) => field.name === 'LeadSource'
				);

				if (!leadSourceField || !leadSourceField.picklistValues) {
					return {
						disabled: true,
						placeholder: 'Lead Source field not found or not a picklist',
						options: [],
					};
				}

				return {
					disabled: false,
					options: leadSourceField.picklistValues.map((value: any) => {
						return {
							label: value.label,
							value: value.value,
						};
					}),
				};
			} catch (e) {
				console.error(e);
				return {
					disabled: true,
					placeholder: "Couldn't fetch lead sources",
					options: [],
				};
			}
		},
	}),
	owner: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Owner',
		description: 'The owner of the task.',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name FROM User WHERE IsActive = true ORDER BY Name'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	opportunity: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Opportunity',
		required: true,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name FROM Opportunity ORDER BY CreatedDate DESC'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	report: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Report',
		required: true,
		refreshers: [],
		refreshOnSearch: true,
		options: async ({ auth }, { searchValue }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}

			let query = 'SELECT Id, Name FROM Report';

			if (searchValue) {
				const sanitizedSearch = searchValue.replace(/'/g, "\\'");
				query += ` WHERE Name LIKE '${sanitizedSearch}%'`;
			}

			query += ' ORDER BY Name';

			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
			}>(auth as OAuth2PropertyValue, query);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
			},
			}),
			parentRecord: Property.Dropdown({
			auth: salesforceAuth,
			displayName: 'Parent Record',
			description:
				'The parent record to find child records for. Shows recently created records.',
		required: true,
		refreshers: ['parent_object'],
		options: async ({ auth, parent_object }) => {
			if (!auth || !parent_object) {
				return {
					disabled: true,
					placeholder: 'Select a parent object first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name?: string;
			}>(
				auth as OAuth2PropertyValue,
				`SELECT Id, Name FROM ${parent_object} ORDER BY CreatedDate DESC`
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Name ?? record.Id,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),

	childRelationship: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Child Relationship',
		description: 'The child relationship to retrieve records from.',
		required: true,
		refreshers: ['parent_object'],
		options: async ({ auth, parent_object }) => {
			if (!auth || !parent_object) {
				return {
					disabled: true,
					placeholder: 'Select a parent object first',
					options: [],
				};
			}
			try {
				const describeResponse = await getSalesforceFields(
					auth as OAuth2PropertyValue,
					parent_object as string
				);
				const relationships = describeResponse.body['childRelationships'];
				if (!relationships) {
					return {
						disabled: true,
						placeholder: 'No child relationships found for this object',
						options: [],
					};
				}
				return {
					disabled: false,
					options: relationships.map((rel: any) => ({
						label: `${rel.relationshipName} (${rel.childSObject})`,
						value: rel.relationshipName,
					})),
				};
			} catch (e) {
				console.error(e);
				return {
					disabled: true,
					placeholder: "Couldn't fetch child relationships",
					options: [],
				};
			}
		},
	}),
	caseQueueId: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Case Queue',
		description: 'The queue to monitor for new cases.',
		required: true,
		refreshers: [],
		refreshOnSearch: true,
		options: async ({ auth }, { searchValue }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}

			let query = `
					SELECT QueueId, Queue.Name
					FROM QueueSobject
					WHERE SobjectType = 'Case'
					`;

			if (searchValue) {
				const sanitizedSearch = searchValue.replace(/'/g, "\\'");
				query += ` AND Queue.Name LIKE '${sanitizedSearch}%'`;
			}

			const { records, truncated } = await fetchAllSalesforceRecords<{
				QueueId: string;
				Queue: { Name: string };
			}>(auth as OAuth2PropertyValue, query);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Queue.Name,
						value: record.QueueId,
					})),
					truncated
				),
			};
		},
	}),
	optionalContact: Property.Dropdown({
		auth: salesforceAuth,
		displayName: 'Contact',
		required: false,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			const { records, truncated } = await fetchAllSalesforceRecords<{
				Id: string;
				Name: string;
				Email?: string;
			}>(
				auth as OAuth2PropertyValue,
				'SELECT Id, Name, Email FROM Contact ORDER BY Name'
			);
			return {
				disabled: false,
				options: withSalesforceTruncationWarning(
					records.map((record) => ({
						label: record.Email
							? `${record.Name} — ${record.Email}`
							: record.Name,
						value: record.Id,
					})),
					truncated
				),
			};
		},
	}),
	taskStatus: createSalesforcePicklistDropdown({
		objectName: 'Task',
		fieldName: 'Status',
		displayName: 'Status',
		required: true,
	}),

	taskPriority: createSalesforcePicklistDropdown({
		objectName: 'Task',
		fieldName: 'Priority',
		displayName: 'Priority',
		required: true,
	}),

	caseStatus: createSalesforcePicklistDropdown({
		objectName: 'Case',
		fieldName: 'Status',
		displayName: 'Status',
		required: false,
	}),

	casePriority: createSalesforcePicklistDropdown({
		objectName: 'Case',
		fieldName: 'Priority',
		displayName: 'Priority',
		required: false,
	}),

	caseOrigin: createSalesforcePicklistDropdown({
		objectName: 'Case',
		fieldName: 'Origin',
		displayName: 'Origin',
		required: false,
	}),
	opportunityStage: createSalesforcePicklistDropdown({
		objectName: 'Opportunity',
		fieldName: 'StageName',
		displayName: 'Stage',
		required: true,
	}),
};

function createSalesforcePicklistDropdown(config: {
	objectName: string;
	fieldName: string;
	displayName: string;
	required: boolean;
	description?: string;
}) {
	return Property.Dropdown({
		auth: salesforceAuth,
		displayName: config.displayName,
		description: config.description,
		required: config.required,
		refreshers: [],
		options: async ({ auth }) => {
			if (!auth) {
				return {
					disabled: true,
					placeholder: 'Connect your account first',
					options: [],
				};
			}
			try {
				const describeResponse = await getSalesforceFields(
					auth as OAuth2PropertyValue,
					config.objectName
				);
				const field = describeResponse.body['fields'].find(
					(field: any) => field.name === config.fieldName
				);
				if (!field || !field.picklistValues) {
					return {
						disabled: true,
						placeholder: `${config.fieldName} field not found or not a picklist`,
						options: [],
					};
				}
				return {
					disabled: false,
					options: field.picklistValues.map((value: any) => ({
						label: value.label,
						value: value.value,
					})),
				};
			} catch (e) {
				console.error(e);
				return {
					disabled: true,
					placeholder: `Couldn't fetch ${config.fieldName} values`,
					options: [],
				};
			}
		},
	});
}

export async function callSalesforceApi<T extends HttpMessageBody>(
	method: HttpMethod,
	authentication: OAuth2PropertyValue,
	url: string,
	body: Record<string, unknown> | undefined
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}${url}`,
		body,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function querySalesforceApi<T extends HttpMessageBody>(
	method: HttpMethod,
	authentication: OAuth2PropertyValue,
	query: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/v56.0/query`,
		queryParams: {
			q: query,
		},
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function createBulkJob<T extends HttpMessageBody = any>(
	method: HttpMethod,
	authentication: OAuth2PropertyValue,
	jobDetails: HttpMessageBody
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/v58.0/jobs/ingest/`,
		body: jobDetails,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function uploadToBulkJob<T extends HttpMessageBody>(
	method: HttpMethod,
	authentication: OAuth2PropertyValue,
	jobId: string,
	csv: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/v58.0/jobs/ingest/${jobId}/batches`,
		headers: {
			'Content-Type': 'text/csv',
		},
		body: csv as unknown as HttpMessageBody,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function notifyBulkJobComplete<T extends HttpMessageBody>(
	method: HttpMethod,
	authentication: OAuth2PropertyValue,
	message: HttpMessageBody,
	jobId: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/v58.0/jobs/ingest/${jobId}`,
		body: message,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

export async function getBulkJobInfo<T extends HttpMessageBody>(
	method: HttpMethod,
	authentication: OAuth2PropertyValue,
	jobId: string
): Promise<HttpResponse<T>> {
	return await httpClient.sendRequest<T>({
		method: method,
		url: `${authentication.data['instance_url']}/services/data/v58.0/jobs/ingest/${jobId}`,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}

async function getSalesforceObjects(
	authentication: OAuth2PropertyValue
): Promise<HttpResponse<HttpMessageBody>> {
	return await httpClient.sendRequest<HttpMessageBody>({
		method: HttpMethod.GET,
		url: `${authentication.data['instance_url']}/services/data/v56.0/sobjects`,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}
// Write function to list all fields name inside salesforce object
async function getSalesforceFields(
	authentication: OAuth2PropertyValue,
	object: string
): Promise<HttpResponse<HttpMessageBody>> {
	return await httpClient.sendRequest<HttpMessageBody>({
		method: HttpMethod.GET,
		url: `${authentication.data['instance_url']}/services/data/v56.0/sobjects/${object}/describe`,
		authentication: {
			type: AuthenticationType.BEARER_TOKEN,
			token: authentication['access_token'],
		},
	});
}
