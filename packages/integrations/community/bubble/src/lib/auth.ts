import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';
import {
  AuthenticationType,
  httpClient,
  HttpMethod,
} from '@inboxfm-connect/pieces-common';

export const bubbleAuth = PieceAuth.CustomAuth({
  description: `Enter Bubble Connection Details
  In the bubble editor click Settings > API 
  1. Your app name is https://appname.bubbleapps.io
  2. Enter/Generate an API key
  `,
  props: {
    appname: Property.ShortText({
      displayName: 'App name',
      description: 'Enter the app name',
      required: true,
    }),
    token: PieceAuth.SecretText({
      displayName: 'API Token',
      description: 'Enter the access token',
      required: true,
    }),
  },
  validate: async ({ auth }) => {
    try {
      // Mirrors the Data API URL the actions use: Bubble answers 401
      // ("Invalid or expired token") for a bad API token and 400 for an
      // unknown app name, so any non-2xx means the connection is broken.
      await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: `https://${auth.appname}.bubbleapps.io/api/1.1/obj/User?limit=1`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.token,
        },
      });
      return {
        valid: true,
      };
    } catch {
      return {
        valid: false,
        error: 'Please enter a valid app name and token',
      };
    }
  },
  required: true,
});

