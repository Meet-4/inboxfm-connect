import { createAction } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { bookedinAuth } from '../auth';
import { BASE_URL, getBookedinHeaders, leadIdDropdown, extractApiKey } from '../common/props';

export const getLead = createAction({
  name: 'getLead',
  displayName: 'Get Lead',
  description: 'Get a specific lead by ID.\n\nDEPRECATED (Nov 2026 liveness census): The API host api.bookedin.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and Bookedin has published no replacement API, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Fetch a single lead by its Bookedin lead ID. Use it to read the full record for one known lead; if you only have a name, email, or phone, find the ID first with Get Leads. Read-only and idempotent.', idempotent: true },
  auth: bookedinAuth,
  props: {
    lead_id: leadIdDropdown,
  },
  async run({ auth, propsValue }) {
    const apiKey = extractApiKey(auth);

    const response = await httpClient.sendRequest({
      method: HttpMethod.GET,
      url: `${BASE_URL}/leads/${propsValue.lead_id}`,
      headers: getBookedinHeaders(apiKey),
    });

    return response.body;
  },
});
