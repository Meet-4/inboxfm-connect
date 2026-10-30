import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { BASE_URL, extractApiKey } from './common/props';

export const bookedinAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  required: true,
  description: `BookedIn is now **Converti**. To connect your Converti account, please follow these steps to retrieve your API Key:

    1. Log in to your Converti dashboard: https://app.converti.ai
    2. From the left menu, go to **Business**
    3. Open **Settings**
    4. Click on **API Key**
    5. Copy your API Key (starts with **sk_…**)
    6. Paste the key below to authorize the integration

    Your API Key allows Activepieces to securely access your Converti (formerly BookedIn) leads, agents, and booking data.
    `,
  validate: async ({ auth }) => {
    try {
      const apiKey = extractApiKey(auth);

      if (!apiKey) {
        return { valid: false, error: 'API Key is empty' };
      }

      await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `${BASE_URL}/agents/`, 
        headers: {
          'X-API-Key': apiKey as string,
          'accept': 'application/json'
        },
        queryParams: {
            skip: '0',
            limit: '1'
        }
      });
      return { valid: true };
    } catch (e: any) {
      const errorMessage = e?.response?.body?.detail || e?.message || 'Connection failed';
      return { 
        valid: false, 
        error: errorMessage 
      };
    }
  },
});

