import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { tldvCommon } from './client';

export const tldvAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: 'Your tl;dv API key. You can find this at https://tldv.io/app/settings/personal-settings/api-keys',
  required: true,
  validate: async ({ auth }) => {
    try {
      await tldvCommon.apiCall({
        method: HttpMethod.GET,
        // /v1alpha1/health is a public health endpoint — it answers 200 with
        // no API key at all, so validating against it accepted every key.
        // /v1alpha1/meetings is key-gated: it returns 401 for a missing or
        // invalid API key.
        url: '/v1alpha1/meetings?limit=1',
        auth: { apiKey: auth as string },
      });
      
      return {
        valid: true,
        message: 'API key validated successfully. Connected to tl;dv.'
      };
    } catch (error: any) {
      if (error.message.includes('401') || error.message.includes('403')) {
        return {
          valid: false,
          error: 'Invalid API key. Please check your API key and try again.',
        };
      }
      
      return {
        valid: false,
        error: `Authentication failed: ${error.message}. Please verify your API key is correct.`,
      };
    }
  },
});

