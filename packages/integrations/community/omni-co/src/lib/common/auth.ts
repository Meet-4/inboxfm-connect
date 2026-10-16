import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';
import { makeRequest } from './client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

export const omniAuth = PieceAuth.CustomAuth({
  description:
    'API is served from your own Omni instance, so enter its URL (the same one you use to log in, e.g. https://myorg.omniapp.co) plus an API key from Settings > API Keys.',
  required: true,
  props: {
    instanceUrl: Property.ShortText({
      displayName: 'Omni Instance URL',
      description:
        'Your Omni instance URL, e.g. https://myorg.omniapp.co (see docs.omni.co — the API base URL is the same URL you use to log in).',
      required: true,
    }),
    apiKey: PieceAuth.SecretText({
      displayName: 'Omni API Key',
      description: 'API key from Settings > API Keys in your Omni instance.',
      required: true,
    }),
  },
  validate: async ({ auth }) => {
    if (auth) {
      try {
        await makeRequest(
          { apiKey: auth.apiKey, instanceUrl: auth.instanceUrl },
          HttpMethod.GET,
          '/models',
          {}
        );
        return {
          valid: true,
        };
      } catch (error) {
        return {
          valid: false,
          error: 'Invalid API key or instance URL',
        };
      }
    }
    return {
      valid: false,
      error: 'Invalid API key or instance URL',
    };
  },
});
