import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

interface KommoAuth {
  subdomain: string;
  apiToken: string;
}

export async function makeRequest(
  auth: KommoAuth,
  method: HttpMethod,
  path: string,
  body?: unknown
) {
  const url = `https://${auth.subdomain}.kommo.com/api/v4${path}`;

  const response = await httpClient.sendRequest({
    method,
    url,
    headers: {
      Authorization: `Bearer ${auth.apiToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  return response.body;
}


// Kommo paginates the v4 list endpoints with the `page` and `limit` query
// parameters (limit is capped at 250 records per request), returning the
// records inside `_embedded` and a 204 with no body past the last page.
// https://www.kommo.com/developers/content/crm_platform/leads-api
export async function fetchKommoList<T>(
  auth: KommoAuth,
  resourcePath: string,
  listKey: string,
  { limit = 250, maxPages = 10 }: { limit?: number; maxPages?: number } = {}
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const response = (await makeRequest(
      auth,
      HttpMethod.GET,
      `${resourcePath}?limit=${limit}&page=${page}`
    )) as { _embedded?: Record<string, unknown> } | undefined | null;

    const batch = (response?._embedded?.[listKey] as T[] | undefined) ?? [];
    items.push(...batch);

    if (batch.length < limit) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}
