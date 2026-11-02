import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { klaviyoAuth, KlaviyoAuthValue } from '../common/auth';
import { makeRequest } from '../common/client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

interface KlaviyoTag {
  type: string;
  id: string;
  attributes: {
    name?: string;
  };
}

export const findTagByName = createAction({
  auth: klaviyoAuth,
  name: 'findTagByName',
  displayName: 'Find Tag by Name',
  description:
    'Find tags whose name contains the search query. Follows Klaviyo cursor pagination (100 tags per page) and returns up to 1000 matches.',
  audience: 'both',
  aiMetadata: {
    description:
      'Searches Klaviyo tags by a partial (contains) name match and returns matching tags with their IDs. Follows Klaviyo cursor pagination (100 per page) and returns up to 1000 matches. Use to discover tag IDs by keyword. Requires a search value; matching is substring-based, not exact. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    search_query: Property.ShortText({
      displayName: 'Tag Name',
      description: 'Search for tags whose name contains this value.',
      required: true,
    }),
  },
  async run({ auth, propsValue }) {
    const { search_query } = propsValue;

    if (!search_query || search_query.trim().length === 0) {
      throw new Error('Tag name is required');
    }

    const trimmedQuery = search_query.trim();
    const filter = `contains(name,"${trimmedQuery.replace(/"/g, '\\"')}")`;

    // Klaviyo paginates with page[size] (max 100) and a cursor in links.next.
    // Walk pages so matching tags beyond the first page are not silently dropped.
    const PER_PAGE = 100;
    const MAX_PAGES = 10; // bounded walk: at most 1000 tags per run

    const filterParams = new URLSearchParams();
    filterParams.append('filter', filter);
    filterParams.append('page[size]', String(PER_PAGE));
    filterParams.append('sort', 'name');

    const tags: KlaviyoTag[] = [];
    let path = `/tags?${filterParams.toString()}`;

    for (let page = 0; page < MAX_PAGES && path; page++) {
      const response: {
        data?: KlaviyoTag[];
        links?: { next?: string | null };
      } = await makeRequest(auth as KlaviyoAuthValue, HttpMethod.GET, path);

      tags.push(...(response.data || []));

      // links.next is a full Klaviyo URL; makeRequest takes a relative path,
      // so keep only its query string (which carries the page[cursor] token).
      path = response.links?.next
        ? response.links.next.substring(response.links.next.indexOf('?'))
        : '';
    }

    if (tags.length === 0) {
      return {
        success: false,
        message: `No tags found containing "${trimmedQuery}"`,
        tags: [],
        count: 0,
      };
    }

    const formattedTags = tags.map((tag) => ({
      id: tag.id,
      name: tag.attributes.name ?? '',
    }));

    return {
      success: true,
      message: `Found ${tags.length} tag(s) containing "${trimmedQuery}"`,
      tags: formattedTags,
      count: tags.length,
      search_query: trimmedQuery,
    };
  },
});

