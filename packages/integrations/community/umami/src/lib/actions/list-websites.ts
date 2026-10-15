import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { umamiAuth, UmamiAuthValue } from '../auth';
import { umamiApiCall } from '../common';

export const listWebsites = createAction({
  auth: umamiAuth,
  name: 'list_websites',
  displayName: 'List Websites',
  description: 'Returns all websites tracked in your Umami account.',
  audience: 'both',
  aiMetadata: {
    description:
      'List all websites tracked in the connected Umami account, returning each website ID, name, and domain. Use this first to discover the website ID that the analytics and event actions require. Takes only an optional result limit. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    limit: Property.Number({
      displayName: 'Max Results',
      description: 'Maximum number of websites to return.',
      required: false,
      defaultValue: 100,
    }),
  },
  async run(context) {
    const { limit } = context.propsValue;
    const maxResults = limit ?? 100;

    // GET /websites is paginated (page/pageSize params; the response carries
    // data/count/page/pageSize — docs.umami.is/docs/api/websites), so a
    // single request returns at most one page. Page through until Max
    // Results is reached or a short page signals the end of the list.
    const pageSize = Math.min(100, maxResults);
    const websites: {
      id: string;
      name: string;
      domain: string;
      shareId: string | null;
      createdAt: string;
    }[] = [];
    let page = 1;
    while (websites.length < maxResults && page <= 100) {
      const response = await umamiApiCall<{
        data: {
          id: string;
          name: string;
          domain: string;
          shareId: string | null;
          createdAt: string;
        }[];
        count: number;
      }>({
        auth: context.auth as UmamiAuthValue,
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

    return websites.slice(0, maxResults).map((w) => ({
      id: w.id,
      name: w.name,
      domain: w.domain,
      share_id: w.shareId ?? null,
      created_at: w.createdAt,
    }));
  },
});
