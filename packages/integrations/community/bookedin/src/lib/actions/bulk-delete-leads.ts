import { createAction } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { bookedinAuth } from '../auth';
import { BASE_URL, getBookedinHeaders, leadIdsMultiSelectDropdown, extractApiKey } from '../common/props';

export const bulkDeleteLeads = createAction({
  name: 'bulkDeleteLeads',
  displayName: 'Bulk Delete Leads',
  description: 'Delete multiple leads (max 500 per request)\n\nDEPRECATED (Nov 2026 liveness census): The API host api.bookedin.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and Bookedin has published no replacement API, so this action cannot reach its API.',
  auth: bookedinAuth,
  props: {
    lead_ids: leadIdsMultiSelectDropdown,
  },
  async run({ auth, propsValue }) {
    const apiKey = extractApiKey(auth);
    const leadIds = Array.isArray(propsValue.lead_ids) ? propsValue.lead_ids : [propsValue.lead_ids];

    if (leadIds.length === 0) {
      throw new Error('At least one lead must be selected');
    }

    if (leadIds.length > 500) {
      throw new Error('Maximum 500 leads can be deleted per request');
    }

    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: `${BASE_URL}/leads/bulk-delete`,
      headers: {
        ...getBookedinHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: {
        lead_ids: leadIds,
      },
    });

    return response.body;
  },
});
