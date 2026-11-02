import {
  AuthenticationType,
  HttpMethod,
  httpClient,
} from '@inboxfm-connect/pieces-common';

type ZendeskSearchResponse = {
  results: Array<Record<string, unknown>>;
  count: number;
  next_page?: string;
  previous_page?: string;
  facets?: unknown;
};

// Zendesk's search endpoint returns up to 100 results per page and at most
// 1000 results per query (10 pages), exposing the next page via `next_page`
// (https://developer.zendesk.com/rest_api/docs/core/search). Walk pages so
// results beyond the first page are not silently dropped.
export async function zendeskPaginatedSearch({
  subdomain,
  email,
  token,
  searchParams,
}: {
  subdomain: string;
  email: string;
  token: string;
  searchParams: URLSearchParams;
}): Promise<ZendeskSearchResponse> {
  const PER_PAGE = 100; // Zendesk search returns a maximum of 100 per page
  const MAX_PAGES = 10; // Zendesk search caps queries at 1000 results (10 pages)

  const firstParams = new URLSearchParams(searchParams);
  firstParams.append('per_page', String(PER_PAGE));

  const firstResponse = await httpClient.sendRequest<ZendeskSearchResponse>({
    url: `https://${subdomain}.zendesk.com/api/v2/search.json?${firstParams.toString()}`,
    method: HttpMethod.GET,
    authentication: {
      type: AuthenticationType.BASIC,
      username: email + '/token',
      password: token,
    },
  });

  const firstBody = firstResponse.body;

  const results: Array<Record<string, unknown>> = [
    ...(firstBody?.results ?? []),
  ];
  let nextPage: string | undefined = firstBody?.next_page;

  for (
    let page = 2;
    page <= MAX_PAGES && nextPage;
    page++
  ) {
    const response = await httpClient.sendRequest<ZendeskSearchResponse>({
      url: nextPage,
      method: HttpMethod.GET,
      authentication: {
        type: AuthenticationType.BASIC,
        username: email + '/token',
        password: token,
      },
    });

    results.push(...(response.body?.results ?? []));
    nextPage = response.body?.next_page;
  }

  return {
    ...firstBody,
    results,
    next_page: nextPage,
  };
}
