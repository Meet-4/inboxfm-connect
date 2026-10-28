import { createCustomApiCallAction, httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { PieceAuth, createPiece } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { createComment } from './lib/actions/create-comment';
import { createNewFeatureRequest } from './lib/actions/create-feature-request';
import { createBeamerPost } from './lib/actions/create-posts';
import { createVote } from './lib/actions/create-vote';
import { beamerCommon } from './lib/common';
import { newPost } from './lib/trigger/new-post';
import { beamerAuth } from './lib/auth';

export const beamer = createPiece({
  displayName: 'Beamer',
  description: 'Engage users with targeted announcements',
  logoUrl: 'https://cdn.activepieces.com/pieces/beamer.png',
  categories: [PieceCategory.PRODUCTIVITY],
  auth: beamerAuth,
  authors: ["i-nithin","kishanprmr","MoShizzle","abuaboud"],
  actions: [
    createBeamerPost,
    createNewFeatureRequest,
    createComment,
    createVote,
    createCustomApiCallAction({
      baseUrl: () => beamerCommon.baseUrl,
      auth: beamerAuth,
      authMapping: async (auth) => ({
        'Beamer-Api-Key': `${auth.secret_text}`,
      }),
    }),
  ],
  triggers: [newPost],
});

