import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';
import { createPiece } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { auditWalletAddress } from './lib/actions/audit-wallet-address';
import { creditScore } from './lib/actions/credit-score';
import { fraudCheck } from './lib/actions/fraud-check';
import { rugPullCheck } from './lib/actions/rug-pull-check';
import { walletSegment } from './lib/actions/wallet-segment';
import { BASE_URL } from './lib/common/client';
import { chainAwareAuth } from './lib/common/auth';

export const chainAware = createPiece({
  displayName: 'ChainAware.AI',
  description: 'Detect risky wallet behavior\n\nDEPRECATED (Nov 2026 liveness census): The API host enterprise.api.chainaware.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and ChainAware has published no replacement base URL, so this action cannot reach its API.',
  auth: chainAwareAuth,
  minimumSupportedRelease: '0.36.1',
  logoUrl: 'https://cdn.activepieces.com/pieces/chain-aware.png',
  authors: ['onyedikachi-david'],
  categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE],
  actions: [
    auditWalletAddress,
    creditScore,
    fraudCheck,
    rugPullCheck,
    walletSegment,
    createCustomApiCallAction({
      auth: chainAwareAuth,
      baseUrl: () => BASE_URL,
      authMapping: async (auth) => {
        return {
          'x-api-key': auth.secret_text,
        };
      },
    }),
  ],
  triggers: [],
});
