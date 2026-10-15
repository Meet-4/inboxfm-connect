import {
  AuthenticationType,
  httpClient,
  HttpMessageBody,
  HttpMethod,
  HttpRequest,
  HttpResponse,
  QueryParams,
} from '@inboxfm-connect/pieces-common';
import { AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { giteaAuth } from '../auth';

export type GiteaApiCallParams = {
  auth: AppConnectionValueForAuthProperty<typeof giteaAuth>;
  method: HttpMethod;
  resourceUri: string;
  query?: QueryParams;
  body?: Record<string, unknown>;
};

export type WebhookInformation = {
  webhookId: number;
  repo: string;
  owner: string;
};

export async function giteaApiCall<T extends HttpMessageBody>({
  auth,
  method,
  resourceUri,
  query,
  body,
}: GiteaApiCallParams): Promise<HttpResponse<T>> {
  const request: HttpRequest = {
    method,
    url: baseUrl(auth) + resourceUri,
    authentication: {
      type: AuthenticationType.BEARER_TOKEN,
      token: auth.access_token,
    },
    queryParams: query,
    body,
  };

  return await httpClient.sendRequest<T>(request);
}

export async function giteaPaginatedApiCall<T extends HttpMessageBody>({
  auth,
  method,
  resourceUri,
  query,
  body,
}: GiteaApiCallParams): Promise<T[]> {
  const qs = query ? { ...query } : {};
  qs['page'] = '1';
  // Gitea's API paginates with `page` and `limit` (default paging size is 30
  // and the default max page size is 50); a GitHub-style `per_page` parameter
  // is ignored, which previously truncated every paginated call to one page.
  // https://docs.gitea.com/1.23/development/api-usage#pagination
  const limit = 50;
  qs['limit'] = limit.toString();

  const resultData: T[] = [];
  let hasMoreItems = true;

  while (hasMoreItems) {
    const response = await giteaApiCall<T[]>({
      auth,
      method,
      resourceUri,
      query: qs,
      body,
    });

    const data = response.body ?? [];

    resultData.push(...data);

    if (data.length < limit) {
      hasMoreItems = false;
    } else {
      qs['page'] = (parseInt(qs['page'] as string) + 1).toString();
    }
  }

  return resultData;
}

export function baseUrl(auth: AppConnectionValueForAuthProperty<typeof giteaAuth>): string {
  const instanceUrl = (auth.props?.['baseUrl'] as string) ?? 'https://gitea.com';
  return instanceUrl.replace(/\/$/, '') + '/api/v1';
}
