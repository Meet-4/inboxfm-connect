import { createPiece } from '@inboxfm-connect/pieces-framework';
import { voucheryIoAuth } from './lib/common/auth';
import { findVoucher } from './lib/actions/find-voucher';
import { createCustomer } from './lib/actions/create-customer';
import { createAVoucher } from './lib/actions/create-a-voucher';
import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';
import { voucheryBaseUrl } from './lib/common/client';

export const voucheryIo = createPiece({
  displayName: 'Vouchery',
  auth: voucheryIoAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/vouchery-io.png',
  authors: ['sanket-a11y'],
  description:
    'Vouchery is a  voucher and gift card management platform.',
  actions: [
    createAVoucher,
    createCustomer,
    findVoucher,
    createCustomApiCallAction({
      auth: voucheryIoAuth,
      baseUrl: (auth) => voucheryBaseUrl(auth?.props?.projectHost),
      authMapping: async (auth) => {
        return {
          Authorization: `Bearer ${auth.props.apiKey}`,
        };
      },
    }),
  ],
  triggers: [],
});
