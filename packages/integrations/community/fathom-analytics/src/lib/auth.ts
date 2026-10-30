import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';

export const FATHOM_API_BASE = 'https://api.usefathom.com/v1';

export const fathomAuth = PieceAuth.SecretText({
  displayName: 'API Token',
  description: `
To create an API token:
1. Go to [https://app.usefathom.com/api](https://app.usefathom.com/api)
2. Click **Create new**
3. Give your token a name and set permissions (Admin, Read Only, or site-specific)
4. Click **Save changes**
5. Copy your API token — you won't be able to retrieve it again after navigating away
  `,
  required: true,
  validate: async ({ auth }) => {
    try {
      const response = await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `${FATHOM_API_BASE}/account`,
        // Unauthenticated requests 302-redirect to the app login page;
        // following it would land on a 200 and accept any token. With
        // redirects unfollowed the 302 must be rejected explicitly.
        followRedirects: false,
        headers: {
          Authorization: `Bearer ${auth}`,
        },
      });
      if (response.status !== 200) {
        return {
          valid: false,
          error: 'Invalid API token. Please check your Fathom API credentials.',
        };
      }
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error: 'Invalid API token. Please check your Fathom API credentials.',
      };
    }
  },
});

