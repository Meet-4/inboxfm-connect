import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';
import { parserExpertCommon } from './client';

export const parserExpertAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: 'Your Parser Expert API key. You can find this in your dashboard under Integration -> New API Key.',
  required: true,
  validate: async ({ auth }) => {
    if (!auth) {
      return {
        valid: false,
        error: 'API key is required',
      };
    }

    try {
      // The API checks the X-API-Key header before validating query
      // params (a bad key gets 401 with or without params), so a 401/403
      // here reliably means the key was rejected. Other statuses only
      // reflect the dummy lookup params below.
      await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `${parserExpertCommon.baseUrl}/v1/extracts`,
        headers: {
          'X-API-Key': auth,
        },
        queryParams: {
          parser_id: '00000000-0000-0000-0000-000000000000',
          bucket_id: '000000000000',
        },
      });
      return {
        valid: true,
      };
    } catch (error: any) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        return {
          valid: false,
          error: 'Invalid API key. Please check your API key and try again.',
        };
      }
      // Bad keys never get past the 401/403 auth gate; anything else
      // comes from the dummy lookup params or a transient failure.
      return {
        valid: true,
      };
    }
  },
});

