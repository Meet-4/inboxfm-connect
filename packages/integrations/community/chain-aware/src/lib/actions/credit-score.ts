import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { chainAwareAuth } from '../common/auth';
import { makeRequest } from '../common/client';

export const creditScore = createAction({
  auth: chainAwareAuth,
  name: 'creditScore',
  displayName: 'Credit Score',
  description: "Get a user's credit score\n\nDEPRECATED (Nov 2026 liveness census): The API host enterprise.api.chainaware.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and ChainAware has published no replacement base URL, so this action cannot reach its API.",
  audience: 'both',
  aiMetadata: {
    description: 'Look up the ChainAware on-chain credit score for a wallet address on a given network. Choose this to assess a wallet\'s creditworthiness or borrowing history rather than fraud risk. Requires the network name and wallet address. Read-only lookup — idempotent.',
    idempotent: true,
  },
  props: {
    network: Property.ShortText({
      displayName: 'Network',
      required: true,
    }),
    walletAddress: Property.ShortText({
      displayName: 'Wallet Address',
      required: true,
    }),
  },
  async run(context) {
    return makeRequest({
      apiKey: context.auth.secret_text,
      method: HttpMethod.POST,
      path: '/users/credit-score',
      body: {
        network: context.propsValue.network,
        walletAddress: context.propsValue.walletAddress,
      },
    });
  },
});

