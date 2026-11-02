import { createAction } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { freshdeskAuth } from '../..';

export const getTickets = createAction({
  auth: freshdeskAuth,
  name: 'get_tickets',
  displayName: 'Get Tickets',
  description:
    'Get Ticket instances from Freshdesk. Follows Freshdesk pagination (100 tickets per page) and returns up to 1000 tickets across pages; use the Freshdesk API request action if you need more.',
  audience: 'both',
  aiMetadata: { description: 'Retrieve the list of support tickets from a Freshdesk account (the default unfiltered tickets endpoint, returning recent tickets). Follows Freshdesk pagination (100 per page) and returns up to 1000 tickets. Use to browse or enumerate tickets when you do not have a specific ticket ID or status filter; for status-filtered results use Get All Tickets By Status instead. Read-only and idempotent.', idempotent: true },
  props: {},

  async run(context) {
    const FDapiToken = context.auth.props.access_token;

    const headers = {
      Authorization: FDapiToken,
      'Content-Type': 'application/json',
    };

    // Remove trailing slash from base_url
    const baseUrl = context.auth.props.base_url.replace(/\/$/, '');

    // Freshdesk list endpoints return a maximum of 100 tickets per page
    // (https://developer.freshdesk.com/api/#pagination). Walk pages so
    // tickets beyond the first page are not silently dropped.
    const PER_PAGE = 100;
    const MAX_PAGES = 10; // bounded walk: at most 1000 tickets per run

    const tickets: Record<string, unknown>[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `${baseUrl}/api/v2/tickets/?per_page=${PER_PAGE}&page=${page}`,
        headers,
      });

      if (page === 1 && response.status !== 200) {
        // Preserve the original error behavior on the first request
        return response;
      }

      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch tickets page ${page}: HTTP ${response.status}`
        );
      }

      const pageTickets = Array.isArray(response.body)
        ? (response.body as Record<string, unknown>[])
        : [];

      tickets.push(...pageTickets);

      if (pageTickets.length < PER_PAGE) {
        break; // last page reached
      }
    }

    return tickets;
  },
});

