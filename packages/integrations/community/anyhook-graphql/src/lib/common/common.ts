import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';

export const graphqlCommon = {
  connectionType: "graphql",
  auth: PieceAuth.CustomAuth({
    required: true,
    props: {
      proxyBaseUrl: Property.ShortText({
        displayName: 'AnyHook Server URL',
        description: 'The URL of your AnyHook server',
        required: true,
        defaultValue: 'http://10.0.0.101:3001'
      }),
    },
  }),
  apiCall: async function (
    url: string,
    method: string,
    data: object | undefined = undefined
  ) {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(
        `AnyHook GraphQL request failed (HTTP ${response.status} ${response.statusText}): ${errorBody.slice(0, 500)}`
      );
    }

    return response.json();
  },
};

