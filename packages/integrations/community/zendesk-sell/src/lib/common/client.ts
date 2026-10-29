import {
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
        body: body,
        queryParams: query, 
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth.secret_text}`
        }
    };
    return httpClient.sendRequest<T>(request);
}