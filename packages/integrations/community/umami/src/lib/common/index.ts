import {
  httpClient,
  HttpMethod,
  HttpMessageBody,
  HttpResponse,
  QueryParams,
} from '@inboxfm-connect/pieces-common';
import { Property } from '@inboxfm-connect/pieces-framework';
import {
  umamiAuth,
  getAuthHeaders,
  getBaseUrl,
  UmamiAuthValue,
} from '../auth';

export async function umamiApiCall<T extends HttpMessageBody>({
  auth,
  method,
  path,
  body,
  queryParams,
}: {
  auth: UmamiAuthValue;
  method: HttpMethod;
  path: string;
  queryParams?: QueryParams;
  body?: unknown;
}): Promise<HttpResponse<T>> {
  const baseUrl = getBaseUrl(auth);
  const headers = getAuthHeaders(auth);

  return await httpClient.sendRequest<T>({
    method,
    url: `${baseUrl}${path}`,
    headers,
    queryParams,
    body,
  });
}

export const umamiCommon = {
  websiteDropdown: Property.Dropdown({
    displayName: 'Website',
    description: 'Select the website to use.',
    auth: umamiAuth,
    refreshers: [],
    required: true,
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account first.',
        };
      }
      try {
        // GET /websites is paginated (docs.umami.is/docs/api/websites);
        // follow pages so accounts with more than one page of websites can
        // still select any of them (capped at 10 pages of 100).
        const websites: { id: string; name: string; domain: string }[] = [];
        const pageSize = 100;
        let page = 1;
        while (page <= 10) {
          const response = await umamiApiCall<{
            data: { id: string; name: string; domain: string }[];
          }>({
            auth: auth as UmamiAuthValue,
            method: HttpMethod.GET,
            path: '/websites',
            queryParams: {
              page: String(page),
              pageSize: String(pageSize),
            },
          });
          websites.push(...response.body.data);
          if (response.body.data.length < pageSize) {
            break;
          }
          page++;
        }
        return {
          disabled: false,
          options: websites.map((w) => ({
            label: `${w.name} (${w.domain})`,
            value: w.id,
          })),
        };
      } catch {
        return {
          disabled: true,
          options: [],
          placeholder: 'Failed to load websites. Check your connection.',
        };
      }
    },
  }),

  dateRange: {
    startDate: Property.DateTime({
      displayName: 'Start Date',
      description: 'Beginning of the date range.',
      required: true,
    }),
    endDate: Property.DateTime({
      displayName: 'End Date',
      description: 'End of the date range.',
      required: true,
    }),
  },
};
