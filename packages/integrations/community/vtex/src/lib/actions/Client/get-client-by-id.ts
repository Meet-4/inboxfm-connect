import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { Client } from '../../common/Client';
import { vtexAuth } from '../../..';

export const getClientById = createAction({
  auth: vtexAuth,
  name: 'get-client-by-id',
  displayName: 'Get Client By ID',
  description: 'Find a Client by Id',
  audience: 'both',
  aiMetadata: {
    description:
      'Retrieve a single client (customer) from the VTEX store master data by its client ID. Use when you already know the client ID and need its details. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    clientId: Property.ShortText({
      displayName: 'Client ID',
      description:
        'The Client ID (Master Data CL document id — a string, e.g. an email or UUID like CL-b345cbda-e489-11e6-94f4-0ac138d2d42e)',
      required: true,
    }),
  },
  async run(context) {
    const { hostUrl, appKey, appToken } = context.auth.props;
    const { clientId } = context.propsValue;

    const client = new Client(hostUrl, appKey, appToken);

    return await client.getClientById(clientId);
  },
});
