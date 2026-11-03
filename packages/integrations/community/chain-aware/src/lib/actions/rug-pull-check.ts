import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { chainAwareAuth } from '../common/auth';
import { makeRequest } from '../common/client';

export const rugPullCheck = createAction({
  auth: chainAwareAuth,
  name: 'rugPullCheck',
  displayName: 'Rug Pull Check',
  description: 'Calculate fraud probability for a contract address\n\nDEPRECATED (Nov 2026 liveness census): The API host enterprise.api.chainaware.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and ChainAware has published no replacement base URL, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: {
    description: 'Calculate a ChainAware rug-pull / fraud-probability score for a smart-contract address (e.g. a token contract) on a given network. Choose this when assessing a token or contract rather than a user wallet — for wallets use Fraud Check instead. Requires the network name and contract address. Read-only analysis — idempotent.',
    idempotent: true,
  },
  props: {
    network: Property.ShortText({
      displayName: 'Network',
      required: true,
    }),
    contractAddress: Property.ShortText({
      displayName: 'Contract Address',
      required: true,
    }),
  },
  async run(context) {
    return makeRequest({
      apiKey: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/rug/pull-check',
      body: {
        network: context.propsValue.network,
        contractAddress: context.propsValue.contractAddress,
      },
    });
  },
});

