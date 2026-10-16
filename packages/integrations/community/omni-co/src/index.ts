import { createPiece } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { omniAuth } from './lib/common/auth';
import { createADocument } from './lib/actions/create-a-document';
import { createASchedule } from './lib/actions/create-a-schedule';
import { deleteADocument } from './lib/actions/delete-a-document';
import { deleteASchedule } from './lib/actions/delete-a-schedule';
import { moveDocument } from './lib/actions/move-document';
import { runQuery } from './lib/actions/run-query';
import { editSchedule } from './lib/actions/edit-schedule';
import { generateQuery } from './lib/actions/generate-query';
import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';

export const omniCo = createPiece({
  displayName: 'Omni',
  auth: omniAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/omni-co.png',
  categories: [PieceCategory.BUSINESS_INTELLIGENCE],
  authors: ['sanket-a11y'],
  actions: [
    createADocument,
    createASchedule,
    deleteADocument,
    deleteASchedule,
    editSchedule,
    generateQuery,
    moveDocument,
    runQuery,
    createCustomApiCallAction({
      // Omni serves each customer from their own instance
      // (https://{instance}.omniapp.co/api) — no shared base URL exists.
      baseUrl: (auth: any) =>
        auth?.props?.instanceUrl
          ? `${auth.props.instanceUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api/v1`
          : '',
      auth: omniAuth,
      authMapping: async (auth: any) => ({
        Authorization: `Bearer ${auth.props.apiKey}`,
      }),
    }),
  ],
  triggers: [],
});
