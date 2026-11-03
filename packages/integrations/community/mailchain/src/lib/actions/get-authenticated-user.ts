import { createAction } from '@inboxfm-connect/pieces-framework';
import { Mailchain } from '@mailchain/sdk';
import { mailchainCommon } from '../common/common';

export const getAuthenticatedUser = createAction({
  name: 'getAuthenticatedUser',
  displayName: 'Get Authenticated User',
  description: 'Get the authenticated user to the Mailchain Protocol\n\nDEPRECATED (Nov 2026 liveness census): Mailchain permanently discontinued its service on 5 May 2026 per its own website; the API host app.mailchain.com no longer resolves, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Resolves the Mailchain identity for the connected secret recovery phrase, returning the account username and Mailchain address. Use to discover the sender identity or verify credentials before sending mail. Read-only and safe to repeat.', idempotent: true },
  auth: mailchainCommon.auth,
  requireAuth: true,
  props: {},
  async run({ auth }) {
    try {
      const secretRecoveryPhrase = auth;

      const mailchain =
        Mailchain.fromSecretRecoveryPhrase(secretRecoveryPhrase.secret_text);

      const user = await mailchain.user();
      return user;
    } catch (error) {
      console.error('Error getting authenticated user (mailchain)', error);
      throw error;
    }
  },
});

