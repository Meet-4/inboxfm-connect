import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';

export const voucheryIoAuth = PieceAuth.CustomAuth({
  description:
    'Connect to your Vouchery project. Provide the API key from My Account and the host of your project (e.g. yourproject.vouchery.app for production, admin.sandbox.vouchery.app for the sandbox).',
  required: true,
  props: {
    apiKey: PieceAuth.SecretText({
      displayName: 'API Key',
      description: 'Vouchery-io API Key',
      required: true,
    }),
    projectHost: Property.ShortText({
      displayName: 'Project Host',
      description:
        "Host of your Vouchery project, e.g. 'yourproject.vouchery.app' (production) or 'admin.sandbox.vouchery.app' (sandbox)",
      required: true,
    }),
  },
});
