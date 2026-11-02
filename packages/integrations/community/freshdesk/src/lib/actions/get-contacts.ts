import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { freshdeskAuth } from '../..';

export const getContacts = createAction({
  auth: freshdeskAuth,
  name: 'get_contacts',
  displayName: 'Get Freshdesk Contacts',
  description:
    'Get contact details from Freshdesk for all (optional filtered) contacts. Follows Freshdesk pagination (100 contacts per page) and returns up to 1000 contacts.',
  audience: 'both',
  aiMetadata: { description: 'List Freshdesk contacts, optionally narrowing the results by an attribute filter (email, mobile, phone, company ID, or updated-since) and/or a state filter (blocked, deleted, unverified, verified). Follows Freshdesk pagination (100 per page) and returns up to 1000 contacts. Use to search for or enumerate contacts when you do not already have a contact ID. Read-only and idempotent.', idempotent: true },

  props: {
    filter_type: Property.StaticDropdown({
      displayName: 'Optional Filter',
      description: 'Select one and provide the value.',
      defaultValue: '',
      required: false,
      options: {
        options: [
          {
            label: 'E-mail',
            value: 'email',
          },
          {
            label: 'Mobile',
            value: 'mobile',
          },
          {
            label: 'Phone',
            value: 'phone',
          },
          {
            label: 'Company ID',
            value: 'company_id',
          },
          {
            label: 'Updated Since',
            value: 'updated_since',
          },
        ],
      },
    }),
    filter_value: Property.ShortText({
      displayName: 'Filter value',
      description: 'Provide value if previous option selected!',
      required: false,
      defaultValue: '',
    }),
    filter_status: Property.StaticDropdown({
      displayName: 'Optional Filter Status',
      description:
        'Can filter by state: blocked, deleted, unverified or verified.',
      defaultValue: '',
      required: false,
      options: {
        options: [
          {
            label: 'Blocked',
            value: 'blocked',
          },
          {
            label: 'Deleted',
            value: 'deleted',
          },
          {
            label: 'Unverified',
            value: 'unverified',
          },
          {
            label: 'Verified',
            value: 'verified',
          },
        ],
      },
    }),
    per_page: Property.Number({
      displayName: 'Results to return per page',
      description:
        'Freshdesk calls this per_page - it sets the page size used while collecting results (max 100). Set 0 to use 100.',
      required: true,
      defaultValue: 0,
    }),
  },

  async run(context) {
    const FDapiToken = context.auth.props.access_token;

    const headers = {
      Authorization: FDapiToken,
      'Content-Type': 'application/json',
    };

    // not needed for gettickets ?${queryParams.toString()}
    const queryParams = new URLSearchParams();
    if (
      context.propsValue.filter_type?.valueOf != null &&
      context.propsValue.filter_value?.valueOf != null
    ) {
      queryParams.append(
        context.propsValue.filter_type?.toString(),
        context.propsValue.filter_value || ''
      );
    }
    if (context.propsValue.filter_status?.valueOf != null) {
      queryParams.append('state', context.propsValue.filter_status || '');
    }
    // Remove trailing slash from base_url
    const baseUrl = context.auth.props.base_url.replace(/\/$/, '');

    // Freshdesk caps per_page at 100 (https://developer.freshdesk.com/api/#pagination).
    // Walk pages so contacts beyond the first page are not silently dropped.
    const PER_PAGE =
      context.propsValue.per_page > 0 && context.propsValue.per_page <= 100
        ? context.propsValue.per_page
        : 100;
    const MAX_PAGES = 10; // bounded walk: at most 1000 contacts per run

    const contacts: Record<string, unknown>[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      queryParams.set('per_page', PER_PAGE.toString());
      queryParams.set('page', page.toString());

      const response = await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `${baseUrl}/api/v2/contacts/?${queryParams.toString()}`,
        headers,
      });

      if (page === 1 && response.status !== 200) {
        // Preserve the original error behavior on the first request
        return response;
      }

      if (response.status !== 200) {
        throw new Error(
          `Failed to fetch contacts page ${page}: HTTP ${response.status}`
        );
      }

      const pageContacts = Array.isArray(response.body)
        ? (response.body as Record<string, unknown>[])
        : [];

      contacts.push(...pageContacts);

      if (pageContacts.length < PER_PAGE) {
        break; // last page reached
      }
    }

    return contacts;
  },
});

