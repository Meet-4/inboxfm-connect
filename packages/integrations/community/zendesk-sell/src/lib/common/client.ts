import {
    AuthenticationType,
    httpClient,
    HttpMethod,
    HttpRequest,
    HttpResponse,
    HttpMessageBody, 
} from '@inboxfm-connect/pieces-common';
import { zendeskSellAuth } from './auth';
import { AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';


export const ZENDESK_SELL_API_URL = 'https://api.getbase.com';

export async function callZendeskApi<T>(
    method: HttpMethod,
    endpoint: string,
    auth: AppConnectionValueForAuthProperty<typeof zendeskSellAuth>,
    body?: HttpMessageBody, 
    query?: Record<string, string> 
): Promise<HttpResponse<T>> {

    const request: HttpRequest = {
        method: method,
        url: `${ZENDESK_SELL_API_URL}/${endpoint}`,
        authentication: {
            type: AuthenticationType.BASIC,
            username: `${auth.props.email}/token`,
            password: auth.props.api_token,
        },
        body: body,
        queryParams: query, 
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    };
    return httpClient.sendRequest<T>(request);
}
// Zendesk Sell paginates every collection endpoint with the standard
// `page` and `per_page` query parameters — the default page size is 25
// and the maximum is 100 records per page.
// https://developer.zendesk.com/api-reference/sales-crm/requests/#pagination
export async function fetchZendeskSellItems<T>(
    endpoint: string,
    auth: AppConnectionValueForAuthProperty<typeof zendeskSellAuth>,
    extraQuery: Record<string, string> = {},
    { perPage = 100, maxPages = 10 }: { perPage?: number; maxPages?: number } = {}
): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];

    for (let page = 1; page <= maxPages; page++) {
        const response = await callZendeskApi<{ items: T[] }>(
            HttpMethod.GET,
            endpoint,
            auth,
            undefined,
            { ...extraQuery, per_page: String(perPage), page: String(page) }
        );

        const batch = response.body?.items ?? [];
        items.push(...batch);

        if (batch.length < perPage) {
            return { items, truncated: false };
        }
    }

    return { items, truncated: true };
}
