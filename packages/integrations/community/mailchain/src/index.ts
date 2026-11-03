import { createPiece } from '@inboxfm-connect/pieces-framework';
import { mailchainCommon } from './lib/common/common';
import { getAuthenticatedUser } from './lib/actions/get-authenticated-user';
import { sendEmail } from './lib/actions/send-email';

export const mailchain = createPiece({
  displayName: 'Mailchain',
  description:
    'Mailchain is a simple, secure, and decentralized communications protocol that enables blockchain-based email.\n\nDEPRECATED (Nov 2026 liveness census): Mailchain permanently discontinued its service on 5 May 2026 per its own website; the API host app.mailchain.com no longer resolves, so this action cannot reach its API.',
  auth: mailchainCommon.auth,
  minimumSupportedRelease: '0.20.0',
  categories: [],
  logoUrl:
    'https://cdn.activepieces.com/pieces/mailchain.png',
  authors: ['ahmad-swanblocks'],
  actions: [getAuthenticatedUser, sendEmail],
  triggers: [],
});
