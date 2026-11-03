import { createAction } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { bookedinAuth } from '../auth';
import { BASE_URL, getBookedinHeaders, extractApiKey } from '../common/props';

export const getLeadStats = createAction({
  name: 'getLeadStats',
  displayName: 'Get Lead Stats',
  description: 'Get lead statistics (Hot, Warm, Cold, Objectives Met, Total).\n\nDEPRECATED (Nov 2026 liveness census): The API host api.bookedin.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and Bookedin has published no replacement API, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Get aggregate lead statistics for the authenticated Bookedin business, such as counts of Hot, Warm, and Cold leads, objectives met, and the total. Use it for a quick pipeline summary rather than fetching individual leads. Takes no input; read-only and idempotent.', idempotent: true },
  auth: bookedinAuth,
  props: {},
  async run({ auth }) {
    const apiKey = extractApiKey(auth);

    const response = await httpClient.sendRequest({
      method: HttpMethod.GET,
      url: `${BASE_URL}/leads/stats`,
      headers: getBookedinHeaders(apiKey),
    });

    return response.body;
  },
});
