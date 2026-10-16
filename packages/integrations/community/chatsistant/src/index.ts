import { createPiece } from '@inboxfm-connect/pieces-framework';
import { sendMessage } from './lib/actions/send-message';
import { formSubmission } from './lib/triggers/form-submission';
import { chatsistantAuth } from './lib/common/auth';
import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';

export const chatsistant = createPiece({
  displayName: 'Chatsistant',
  auth: chatsistantAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/chatsistant.png',
  authors: ['sanket-a11y'],
  actions: [
    sendMessage,
    createCustomApiCallAction({
      baseUrl: () => 'https://app.chatsistant.com/api/v1',
      auth: chatsistantAuth,
      authMapping: async (auth) => {
        return {
          Authorization: `Bearer ${auth.secret_text}`,
        };
      },
    }),
  ],
  triggers: [formSubmission],
});

