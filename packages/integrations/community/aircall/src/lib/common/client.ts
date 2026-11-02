import { AuthenticationType, HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

export const BASE_URL = `https://api.aircall.io/v1`;

// Aircall paginates list endpoints (default 20 per page, per_page max 50)
// and exposes the next page through `meta.next_page_link`. The list
// endpoints are also capped at 10,000 records per query.
// https://support.aircall.io/en-gb/articles/34702023578397
export async function makePagedRequest<T>(
  auth: { username: string; password: string },
  path: string,
  listKey: string,
  { perPage = 50, maxPages = 10 }: { perPage?: number; maxPages?: number } = {}
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const response = (await makeRequest(auth, HttpMethod.GET, `${path}?per_page=${perPage}&page=${page}`)) as {
      [key: string]: unknown;
      meta?: { next_page_link?: string | null };
    };

    const batch = (response[listKey] as T[] | undefined) ?? [];
    items.push(...batch);

    if (batch.length === 0 || !response.meta?.next_page_link) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}


export async function makeRequest(
  auth: { username: string; password: string },
  method: HttpMethod,
  path: string,
  body?: unknown
) {
  try {
    const response = await httpClient.sendRequest({
      method,
      url: `${BASE_URL}${path}`,
      authentication:{
        type:AuthenticationType.BASIC,
        username:auth.username,
        password:auth.password
      },
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    });

    // Handle different status codes
    if (response.status >= 200 && response.status < 300) {
      return response.body;
    }

    // Handle specific error cases
    switch (response.status) {
      case 400:
        throw new Error(
          `Bad Request: The request could not be processed. Please check your input parameters.`
        );
      case 403:
        throw new Error(
          `Forbidden: Invalid authentication credentials or insufficient permissions.`
        );
      case 404:
        throw new Error(
          `Not Found: The requested resource could not be found.`
        );
      case 405:
        throw new Error(
          `Method Not Allowed: The HTTP method is not supported for this endpoint.`
        );
      case 500:
        throw new Error(
          `Internal Server Error: Aircall server encountered an unexpected condition.`
        );
      default:
        throw new Error(
          `HTTP ${response.status}: ${
            response.body?.message || 'Unknown error occurred'
          }`
        );
    }
  } catch (error: any) {
    // Re-throw if it's already our custom error
    if (
      error.message.includes('Bad Request') ||
      error.message.includes('Forbidden') ||
      error.message.includes('Not Found') ||
      error.message.includes('Method Not Allowed') ||
      error.message.includes('Internal Server Error')
    ) {
      throw error;
    }

    // Handle network or other unexpected errors
    throw new Error(`Request failed: ${error.message || String(error)}`);
  }
}

