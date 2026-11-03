import { createPiece, PieceAuth } from "@inboxfm-connect/pieces-framework";
import { sendMessageAction } from "./lib/actions/send-message";
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { chatflyAuth } from './lib/auth';

export const chatfly = createPiece({
  displayName: "Chatfly",
  description: "ChatFly allows you to build AI chatbots trained on your data.\n\nDEPRECATED (Nov 2026 liveness census): The API host backend.chatfly.co no longer resolves (NXDOMAIN confirmed on multiple resolvers), so this action cannot reach its API.",
  categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE],
  auth: chatflyAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: "https://cdn.activepieces.com/pieces/chatfly.png",
  authors: ["onyedikachi-david"],
  actions: [sendMessageAction],
  triggers: [],
});

