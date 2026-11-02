import {
	httpClient,
	HttpHeaders,
	HttpMessageBody,
	HttpMethod,
	HttpRequest,
	QueryParams,
} from '@inboxfm-connect/pieces-common';
import { PiecePropValueSchema } from '@inboxfm-connect/pieces-framework';
import { zohoDeskAuth } from './auth';

export type ZohoDeskApiCallParams = {
	auth: PiecePropValueSchema<typeof zohoDeskAuth>;
	orgId?: string;
	method: HttpMethod;
	resourceUri: string;
	query?: Record<string, string | number | string[] | undefined>;
	body?: any;
};

export async function zohoDeskApiCall<T extends HttpMessageBody>({
	auth,
	orgId,
	method,
	resourceUri,
	query,
	body,
}: ZohoDeskApiCallParams): Promise<T> {
	const location = auth.props?.['location'] ?? 'zoho.com';
	const baseUrl = `https://desk.${location}/api/v1`;
	const qs: QueryParams = {};

	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value !== null && value !== undefined) {
				qs[key] = String(value);
			}
		}
	}

	const headers: HttpHeaders = {
		Authorization: `Zoho-oauthtoken ${auth.access_token}`,
	};

	if (orgId) {
		headers['orgId'] = orgId;
	}

	const request: HttpRequest = {
		method,
		url: baseUrl + resourceUri,
		headers,
		queryParams: qs,
		body,
	};

	const response = await httpClient.sendRequest<T>(request);
	return response.body;
}

// Zoho Desk listing APIs paginate with the `from` (start index) and `limit`
// (page size, provider maximum 100) query parameters and return records in a
// `data` array. Walk pages until a short page or the page bound is hit so
// records beyond the first page are not silently dropped.
export async function zohoDeskPaginatedApiCall<T = Record<string, unknown>>({
	auth,
	orgId,
	method,
	resourceUri,
	query,
	body,
	maxPages = 10,
}: ZohoDeskApiCallParams & { maxPages?: number }): Promise<T[]> {
	const PER_PAGE = 100; // Zoho Desk listing APIs cap `limit` at 100
	const results: T[] = [];

	for (let page = 0; page < maxPages; page++) {
		const response = await zohoDeskApiCall<{ data?: T[] }>({
			auth,
			orgId,
			method,
			resourceUri,
			query: {
				...query,
				from: page * PER_PAGE,
				limit: PER_PAGE,
			},
			body,
		});

		const pageData = Array.isArray(response?.data) ? response.data : [];

		results.push(...pageData);

		if (pageData.length < PER_PAGE) {
			break; // last page reached
		}
	}

	return results;
}
