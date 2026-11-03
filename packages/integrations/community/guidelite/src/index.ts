import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { sendAPrompt } from './lib/actions/send-a-prompt';
import { newLeadSubmission } from './lib/triggers/new-lead-submission';
import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';
import { guideliteAuth } from './lib/common/auth';
import { BASE_URL } from './lib/common/client';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';

export const guidelite = createPiece({
  displayName: 'GuideLite',
  auth: guideliteAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/guidelite.png',
  authors: ['sanket-a11y'],
  description:
    'GuideLite is a platform that helps organizations build and utilize AI assistants\n\nDEPRECATED (Nov 2026 liveness census): The API hosts api.guidelite.ai and docs.guidelite.ai no longer resolve and guidelite.ai now hosts a different product, so this action cannot reach its API.',
  categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE],
  actions: [
    sendAPrompt,
    createCustomApiCallAction({
      auth: guideliteAuth,
      baseUrl: () => BASE_URL,
      authMapping: async (auth) => {
        return {
          authorization: `Bearer ${auth.secret_text}`,
        };
      },
    }),
  ],
  triggers: [newLeadSubmission],
});

