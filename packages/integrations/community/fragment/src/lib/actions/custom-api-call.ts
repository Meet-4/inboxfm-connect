import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';
import { fragmentAuth } from '../common/auth';

export const customApiCall = createCustomApiCallAction({
  auth: fragmentAuth,
  name: 'custom_api_call',
  displayName: 'Custom API Call',
  description: 'Make a custom API call to any Fragment endpoint',
  baseUrl: () => 'https://api.onfragment.com/api/v1',
  authMapping: async (auth) => ({
    'Authorization': `Bearer ${auth.secret_text}`,
    'Content-Type': 'application/json',
  }),
});


