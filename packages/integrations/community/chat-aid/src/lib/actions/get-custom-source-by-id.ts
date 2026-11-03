import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { ChatAidAuth } from '../common/auth';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { makeRequest } from '../common/client';

export const getCustomSourceById = createAction({
  auth: ChatAidAuth,
  name: 'getCustomSourceById',
  displayName: 'Get Custom Source by ID',
  description: 'Retrieve single source details by ID\n\nDEPRECATED (Nov 2026 liveness census): The API host api.chataid.com is a dangling CNAME to a deleted AWS load balancer and does not resolve; Chat Aid has published no replacement host, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Fetch the details of a single custom source in the Chat Aid knowledge base by its source ID. Use this to look up or verify a specific source you already have an ID for. Idempotent read-only lookup.', idempotent: true },
  props: {
    sourceId: Property.ShortText({
      displayName: 'Source ID',
      description: 'The ID of the custom source to retrieve',
      required: true,
    }),
  },
  async run(context) {
    const sourceId = context.propsValue.sourceId as string;

    const response = await makeRequest(
      context.auth.secret_text,
      HttpMethod.GET, 
      `/external/sources/custom/${encodeURIComponent(sourceId)}`,
      undefined
    );

    return response;
  },
});

