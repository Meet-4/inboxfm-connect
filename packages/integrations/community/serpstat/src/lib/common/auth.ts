import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

import { serpstatApiCall } from './client';

export const serpstatAuth = PieceAuth.SecretText({
  displayName: 'API Token',
  description: `You can obtain your API token from your Serpstat account. Go to your Serpstat dashboard and navigate to API settings to get your token.`,
  required: true,
  validate: async ({ auth }) => {
    try {
      // The bare /v4/ root answers HTTP 200 to any request, token or not, so
      // it proves nothing about the token. Serpstat authenticates JSON-RPC
      // method calls, and reports a bad token as HTTP 200 with an error body
      // (code -32020, "Invalid token!" / "Missing token!"), so the response
      // body must be inspected, not just the status code.
      const body = (await serpstatApiCall({
        apiToken: auth,
        method: HttpMethod.POST,
        resourceUri: '/',
        body: {
          id: 1,
          method: 'SerpstatKeywordProcedure.getSuggestions',
          params: {
            keyword: 'serpstat',
            se: 'g_us',
            page: 1,
            size: 1,
          },
        },
      })) as { error?: { code?: number; message?: string } };

      const error = body?.error;
      const tokenRejected =
        error?.code === -32020 ||
        (error?.message ?? '').toLowerCase().includes('token');
      if (tokenRejected) {
        return {
          valid: false,
          error: 'Invalid API token. Please check your token and try again.',
        };
      }
      return { valid: true };
    } catch (error: any) {
      if (error.response?.status === 401) {
        return {
          valid: false,
          error: 'Invalid API token. Please check your token and try again.',
        };
      }
      return {
        valid: false,
        error: 'Authentication failed. Please check your API token.',
      };
    }
  },
}); 