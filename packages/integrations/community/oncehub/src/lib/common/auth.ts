import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { makeRequest } from './client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

export const oncehubAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: 'Oncehub API Key',
  required: true,
  validate: async ({ auth }) => {
    try {
      await makeRequest(auth, HttpMethod.GET, '/test');

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: 'Invalid API credentials',
      };
    }
  },
});
