import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { chainAwareAuth } from '../common/auth';
import { makeRequest } from '../common/client';

export const walletSegment = createAction({
  auth: chainAwareAuth,
  name: 'walletSegment',
  displayName: 'Wallet Segment',
  description: 'Get wallet behaviour information\n\nDEPRECATED (Nov 2026 liveness census): The API host enterprise.api.chainaware.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and ChainAware has published no replacement base URL, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: {
    description: 'Retrieve ChainAware behavioural segmentation for a wallet address on a given network — how the wallet is categorized based on its on-chain activity. Choose this to profile or classify a wallet rather than score its fraud risk. Requires the network name and wallet address. Read-only lookup — idempotent.',
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
      path: '/segmentation/wallet-segment',
      body: {
        walletAddress: context.propsValue.walletAddress,
        network: context.propsValue.network,
      },
    });
  },
});

