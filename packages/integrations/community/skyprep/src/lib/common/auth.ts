import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { makeRequest } from './client';

export const skyprepAuth = PieceAuth.CustomAuth({
  description: `Authenticate with your SkyPrep API key and platform domain.

1. Log in to your SkyPrep platform and open **Settings → System Configuration → API Key Manager**.
2. Copy an existing API key or create a new one.
3. Enter your SkyPrep platform domain (e.g. \`acme.skyprepapp.com\`) without the https:// prefix.

Both values are required on every API call: the API key is sent as the \`X-SkyPrep-API-Key\` header and the platform domain as the \`X-SkyPrep-Acct-Key\` header.`,
  props: {
    api_key: PieceAuth.SecretText({
      displayName: 'API Key',
      description: 'Your SkyPrep API key',
      required: true,
    }),
    acct_key: Property.ShortText({
      displayName: 'Platform Domain (acct_key)',
      description:
        'Your SkyPrep platform domain, e.g. acme.skyprepapp.com (no http/https prefix)',
      required: true,
    }),
  },
  validate: async ({ auth }) => {
    try {
      await makeRequest(
        { api_key: auth.api_key, acct_key: auth.acct_key },
        HttpMethod.POST,
        '/test_connection'
      );
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error:
          e instanceof Error
            ? e.message
            : 'Invalid API key or platform domain.',
      };
    }
  },
  required: true,
});
