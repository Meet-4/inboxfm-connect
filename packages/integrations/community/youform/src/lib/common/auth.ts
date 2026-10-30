import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import {
  AuthenticationType,
  httpClient,
  HttpMethod,
} from '@inboxfm-connect/pieces-common';
import { BASE_URL } from './constants';

export const youformAuth = PieceAuth.SecretText({
  displayName: 'API Token',
  description: `You can obtain API token from [Account Settings](https://app.youform.com/account).`,
  required: true,
  validate: async ({ auth }) => {
    try {
      const response = await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: BASE_URL + '/me',
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth,
        },
        // Unauthenticated requests to Youform's API redirect (302) to the
        // login page; following it would land on a 200 and accept any token.
        followRedirects: false,
      });
      // With redirects unfollowed, a 302 resolves without throwing, so the
      // status must be checked explicitly to reject unauthenticated tokens.
      if (response.status !== 200) {
        return {
          valid: false,
          error: 'Invalid API Token',
        };
      }
      return {
        valid: true,
      };
    } catch {
      return {
        valid: false,
        error: 'Invalid API Token',
      };
    }
  },
});
