import { createAction } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { bookedinAuth } from '../auth';
import { BASE_URL, getBookedinHeaders, leadIdDropdown, extractApiKey } from '../common/props';

export const deleteLead = createAction({
  name: 'deleteLead',
  displayName: 'Delete Lead',
  description: 'Delete a lead.\n\nDEPRECATED (Nov 2026 liveness census): The API host api.bookedin.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and Bookedin has published no replacement API, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Permanently delete a lead by its Bookedin lead ID. Use it to remove a known lead from the pipeline; this is destructive and cannot be undone. Idempotent on the end state — once the lead is gone, re-running targets an already-removed record.', idempotent: true },
  auth: bookedinAuth,
  props: {
    lead_id: leadIdDropdown,
  },
  async run({ auth, propsValue }) {
    const apiKey = extractApiKey(auth);

    const response = await httpClient.sendRequest({
      method: HttpMethod.DELETE,
      url: `${BASE_URL}/leads/${propsValue.lead_id}`,
      headers: getBookedinHeaders(apiKey),
    });

    return response.body;
  },
});
