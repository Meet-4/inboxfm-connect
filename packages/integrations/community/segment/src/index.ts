
import { createPiece, PieceAuth } from "@inboxfm-connect/pieces-framework";
import { httpClient, HttpMethod } from "@inboxfm-connect/pieces-common";
import { identifyUser } from "./lib/actions/identify-user";

export const segmentAuth = PieceAuth.SecretText({
  displayName: 'Analytics Key',
  required: true,
  description: 'Copy and paste your analytics write key here',
  validate: async ({ auth }) => {
    try {
      await httpClient.sendRequest({
        method: HttpMethod.GET,
        // The write-key-addressed settings endpoint Segment's client libraries
        // call; unknown write keys are rejected
        url: `https://cdn.segment.com/v1/projects/${auth}/settings`,
      });
      return { valid: true };
    } catch (e) {
      return {
        valid: false,
        error:
          'Invalid analytics write key. Check the key under Segment > Connections > Sources > your source > Settings.',
      };
    }
  },
});


export const segment = createPiece({
  displayName: "Segment",
  auth: segmentAuth,
  minimumSupportedRelease: '0.30.0',
  logoUrl: "https://cdn.activepieces.com/pieces/segment.png",
  authors: ['abuaboud'],
  actions: [identifyUser],
  triggers: [],
});
