import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';
import {
  AuthenticationType,
  HttpMethod,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import {
  OAuth2PropertyValue,
  PieceAuth,
  createPiece,
} from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { zoomCreateMeeting } from './lib/actions/create-meeting';
import { zoomCreateMeetingRegistrant } from './lib/actions/create-meeting-registrant';
import { zoomFindMeeting } from './lib/actions/find-meeting';
import { zoomUpdateMeeting } from './lib/actions/update-meeting';

export const zoomAuth = PieceAuth.OAuth2({
  description: `
  1. Go to [marketplace.zoom.us](https://marketplace.zoom.us/) and log in to your account.
  2. In the upper-right corner, click **Develop** then **Build App**.
  3. Select **General App**.
  4. Copy the Client ID and Client Secret.Add Redirect URL and press continue.
  5. Go to **Scopes** from left side bar and add **meeting:write:meeting**, **meeting:read:meeting**, **meeting:read:list_meetings**, **meeting:update:meeting**, **webinar:read:webinar**, and **meeting:write:registrant** as scopes.`,
  authUrl: 'https://zoom.us/oauth/authorize',
  tokenUrl: 'https://zoom.us/oauth/token',
  required: true,
  // scope: ['meeting:write:admin', 'meeting:write'],
  scope: [],
  validate: async ({ auth }) => {
    try {
      await httpClient.sendRequest({
        method: HttpMethod.GET,
        // Same call and scope the meeting dropdown relies on, so a connection
        // that passes validation can actually use the piece
        url: 'https://api.zoom.us/v2/users/me/meetings',
        queryParams: {
          type: 'scheduled',
          page_size: '1',
        },
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.access_token,
        },
      });
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error:
          'Invalid Zoom connection. Reconnect and make sure your Zoom app has the meeting:read:list_meetings scope.',
      };
    }
  },
});

export const zoom = createPiece({
  displayName: 'Zoom',
  description: 'Video conferencing, web conferencing, webinars, screen sharing',

  minimumSupportedRelease: '0.30.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/zoom.png',
  categories: [PieceCategory.COMMUNICATION],
  actions: [
    zoomCreateMeeting,
    zoomCreateMeetingRegistrant,
    zoomFindMeeting,
    zoomUpdateMeeting,
    createCustomApiCallAction({
      baseUrl: () => 'https://api.zoom.us/v2',
      auth: zoomAuth,
      authMapping: async (auth) => {
        const typedAuth = auth as OAuth2PropertyValue;
        return {
          Authorization: `Bearer ${typedAuth.access_token}`,
        };
      },
    }),
  ],
  auth: zoomAuth,
  authors: ['kanarelo', 'kishanprmr', 'MoShizzle', 'khaledmashaly', 'abuaboud', 'murex971'],
  triggers: [],
});
