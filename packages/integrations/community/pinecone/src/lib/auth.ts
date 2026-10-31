import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';

export const pineconeAuth = PieceAuth.CustomAuth({
  description: 'Configure your Pinecone API key',
  required: true,
  props: {
    apiKey: Property.LongText({
      displayName: 'API Key',
      description: 'Enter your Pinecone API key. You can create a new API key in the Pinecone console for your target project.',
      required: true,
    }),
  },
  validate: async ({ auth }) => {
    const { apiKey } = auth;

    if (!apiKey || typeof apiKey !== 'string') {
      return {
        valid: false,
        error: 'API key is required',
      };
    }

    try {
      // Listing indexes requires a valid key; api.pinecone.io answers
      // 401 for a bad or missing key.
      await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: 'https://api.pinecone.io/indexes',
        headers: {
          'Api-Key': apiKey,
        },
      });
      return {
        valid: true,
      };
    } catch {
      return {
        valid: false,
        error:
          'Invalid Pinecone API key. Please check your API key and try again.',
      };
    }
  }
});
