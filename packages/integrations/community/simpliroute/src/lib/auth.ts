import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';

export const simplirouteAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  required: true,
  description: 'Your SimpliRoute API token. You can find this in your SimpliRoute account settings under API section.',
  validate: async (auth) => {
    try {
      const token = typeof auth === 'string' ? auth : (auth as { auth?: string })?.auth || auth;

      if (!token || typeof token !== 'string') {
        return {
          valid: false,
          error: 'Invalid token format'
        };
      }
      
      const response = await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `https://api.simpliroute.com/v1/accounts/api-token/${token}/validate/`,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      if (response.status === 200 && response.body && response.body.isvalid === true) {
        return {
          valid: true
        };
      }
      
      return {
        valid: false,
        error: 'Invalid API token or authentication failed'
      };
    } catch (error) {
      return {
        valid: false,
        error: 'Failed to validate API token. Please check your token and try again.'
      };
    }
  }
});
