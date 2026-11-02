import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { freshdeskAuth } from '../..';

export const getAllTicketsByStatus = createAction({
  auth: freshdeskAuth,
  name: 'get_all_tickets_by_status',
  displayName: 'Get All Tickets By Status',
  description:
    'Get All Tickets by selected status from Freshdesk. Follows Freshdesk search pagination (30 tickets per page, up to 10 pages) and returns up to 300 matching tickets.',
  audience: 'both',
  aiMetadata: { description: 'Search Freshdesk tickets filtered to one or more selected workflow states (Open, Pending, Resolved, Closed), combining the chosen statuses with OR. Follows Freshdesk search pagination (30 per page, up to 10 pages) and returns up to 300 matching tickets. Use when you want tickets matching specific statuses rather than the full unfiltered list from Get Tickets. At least one status must be selected. Read-only and idempotent.', idempotent: true },

  props: {
    status_filter: Property.StaticMultiSelectDropdown({
      displayName: 'Choose Status(es)',
      description: 'Select one or status values',
      required: true,
      options: {
        options: [
          {
            label: 'Open',
            value: 'status:2'
          },
          {
            label: 'Pending',
            value: 'status:3'
          },
          {
            label: 'Resolved',
            value: 'status:4'
          },
          {
            label: 'Closed',
            value: 'status:5'
          }
        ]
      }
    }),
  },

  async run(context) {
    const FDapiToken = context.auth.props.access_token;

    const headers = {
      Authorization: FDapiToken,
      'Content-Type': 'application/json',
    };

    // Remove trailing slash from base_url
    const baseUrl = context.auth.props.base_url.replace(/\/$/, '');
    const queryParams = new URLSearchParams();

    // Adjusted to accept number or string
    const replacedArray = context.propsValue.status_filter.map(str => str.replace(/,/g, ' OR '));
    const replacedString = '"' + replacedArray.join(' OR ') + '"';
    queryParams.append('query', replacedString || '');

    const url = `${baseUrl}/api/v2/search/tickets/?${queryParams.toString()}`;

    // Freshdesk search endpoints return a fixed 30 results per page and only
    // support the `page` parameter (per_page is rejected). Walk pages so
    // matching tickets beyond the first page are not silently dropped.
    const MAX_PAGES = 10; // provider caps search at 10 pages -> up to 300 tickets
    const PER_PAGE = 30;

    const mergedResults: Array<Record<string, any>> = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `${url}&page=${page}`,
        headers,
      });

      if (page === 1 && response.status !== 200) {
        // Preserve the original error behavior on the first request
        return response.status;
      }

      if (response.status !== 200) {
        throw new Error(
          `Failed to search tickets page ${page}: HTTP ${response.status}`
        );
      }

      const pageResults = Array.isArray(response.body?.results)
        ? response.body.results
        : [];

      mergedResults.push(...pageResults);

      if (pageResults.length < PER_PAGE) {
        break; // last page reached
      }
    }

    if (mergedResults.length > 0) {
      // Define an interface for the ticket structure
      interface Ticket {
        id: number;
        requester_id: number;
        responder_id: number | null;
        company_id: number;
        status: number | string; // Adjusted to accept number or string
        subject: string;
        created_at: string;
        updated_at: string;
        description_text: string;
        description: string;
        // Add more properties if necessary
      }

      // response.body.results is an array of ticket objects
      const ticketResults: Ticket[] = mergedResults as Ticket[];

      // Sort the ticketResults array by requester_id
      ticketResults.sort((a, b) => a.requester_id - b.requester_id);

      // Initialize an empty array to store tickets
      const tickets: Ticket[] = [];

      // Iterate through each ticket result and push it to the tickets array
      ticketResults.forEach((ticketResult: Ticket) => {
        // Map status number to corresponding string
        let statusString: string;
        switch (ticketResult.status) {
          case 2:
            statusString = 'Open';
            break;
          case 3:
            statusString = 'Pending';
            break;
          case 4:
            statusString = 'Resolved';
            break;
          case 5:
            statusString = 'Closed';
            break;
          default:
            statusString = 'Unknown';
        }

        // Push the ticket object with modified status string to the tickets array
        tickets.push({
          id: ticketResult.id,
          requester_id: ticketResult.requester_id,
          responder_id: ticketResult.responder_id,
          company_id: ticketResult.company_id,
          status: statusString,
          subject: ticketResult.subject,
          created_at: ticketResult.created_at,
          updated_at: ticketResult.updated_at,
          description_text: ticketResult.description_text,
          description: ticketResult.description,
          // Add more properties if necessary
        });
      });

      // Return the tickets array
      return tickets;
    } else {
      return [];
    }
  },
});

