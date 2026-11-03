
import { createPiece } from "@inboxfm-connect/pieces-framework";
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { generateAnswerAction } from "./lib/actions/generate-answer";
import { createCustomApiCallAction } from "@inboxfm-connect/pieces-common";
import { dashworksAuth } from "./lib/common/auth";

export const dashworks = createPiece({
  displayName: "Dashworks",
  categories: [PieceCategory.PRODUCTIVITY],
  auth: dashworksAuth,
  description: 'DEPRECATED (Nov 2026 liveness census): The API host api.dashworks.ai is a dangling CNAME to a deleted AWS load balancer and does not resolve; Dashworks has published no replacement host, so this piece cannot reach its API.',
  minimumSupportedRelease: '0.36.1',
  logoUrl: "https://cdn.activepieces.com/pieces/dashworks.png",
  authors: ["kishanprmr"],
  actions: [generateAnswerAction,
    createCustomApiCallAction({
      auth: dashworksAuth,
      baseUrl: () => 'https://api.dashworks.ai/v1/',
      authMapping: async (auth) => {
        return {
          Authorization: `Bearer ${auth.secret_text}`
        }
      }
    })
  ],
  triggers: [],
});

