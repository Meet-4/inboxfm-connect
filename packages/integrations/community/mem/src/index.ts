import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';
import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { createMemAction } from './lib/actions/create-mem';
import { createNoteAction } from './lib/actions/create-note';
import { deleteNoteAction } from './lib/actions/delete-note';
import { memAuth } from './lib/auth';

export const mem = createPiece({
  displayName: 'Mem',
  description: 'Capture and organize your thoughts using Mem.ai',
  auth: memAuth,
  logoUrl: 'https://cdn.activepieces.com/pieces/mem.png',
  authors: ['krushnarout', 'kishanprmr'],
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [
    createMemAction,
    createNoteAction,
    deleteNoteAction,
    createCustomApiCallAction({
      auth: memAuth,
      baseUrl: () => 'https://api.mem.ai/v2',
      authMapping: async (auth) => {
        return {
          Authorization: `Bearer ${auth.secret_text}`,
        };
      },
    }),
  ],
  triggers: [],
});

