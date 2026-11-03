
    import { createPiece, PieceAuth } from "@inboxfm-connect/pieces-framework";
    import { startBrowsingTask } from "./lib/actions/start-browsing-task";
    
    export const twinLabsAuth = PieceAuth.SecretText({
      displayName:'API Key',
      required:true,
      description:"Please use ***your-twin-labs-api-key*** as value for API Key"
    });

    export const twinLabs = createPiece({
      displayName: "Twin Web Agent",
      auth: twinLabsAuth,
      description: 'DEPRECATED (Nov 2026 liveness census): The API host paris.prod.api.twin.so no longer resolves; Twin moved to build.twin.so with a new agent-based REST API (no /browse endpoint), so this piece needs a full rewrite.',
      minimumSupportedRelease: '0.20.0',
      logoUrl: "https://cdn.activepieces.com/pieces/twin-labs.png",
      authors: [],
      actions: [startBrowsingTask],
      triggers: [],
    });
    