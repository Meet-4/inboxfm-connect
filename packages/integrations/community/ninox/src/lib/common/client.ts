import { HttpMethod, QueryParams, httpClient } from '@inboxfm-connect/pieces-common';


export const BASE_URL = `https://api.ninox.com/v1`;

export async function makeRequest<T>(
    api_key: string,
    method: HttpMethod,
    path: string,
    body?: unknown,
    headers?: Record<string, string> | string,
) {
    try {
        let mergedHeaders: Record<string, string> = {
            'Authorization': `Bearer ${api_key}`,
            'Content-Type': 'application/json',
        };

        if (typeof headers === 'string') {
            mergedHeaders['Content-Type'] = headers;
        } else if (typeof headers === 'object' && headers !== null) {
            mergedHeaders = {
                ...mergedHeaders,
                ...headers,
            };
        }

        // A FormData body owns its multipart boundary. A fixed Content-Type
        // without that boundary (e.g. 'multipart/form-data' or the JSON
        // default below) makes the request unparseable — let fetch derive
        // the header from the body instead.
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
            delete mergedHeaders['Content-Type'];
        }

        const response = await httpClient.sendRequest<T>({
            method,
            url: `${BASE_URL}${path}`,
            headers: mergedHeaders,
            body,
        });
        return response.body;

    } catch (error: any) {
        throw new Error(`Unexpected error: ${error.message || String(error)}`);
    }

}