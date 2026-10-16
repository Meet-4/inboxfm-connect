import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { kudosityAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';

export const getSmsInfo = createAction({
  auth: kudosityAuth,
  name: 'getSmsInfo',
  displayName: 'Get SMS info',
  description: 'Retrieve details for a sent SMS by ID',
  audience: 'both',
  aiMetadata: {
    description:
      'Look up the details and delivery status of a previously sent SMS by its message ID (the UUID returned when the message was sent). Use to check status or fetch metadata for a known message. Read-only and safe to repeat.',
    idempotent: true,
  },
  props: {
    id: Property.ShortText({
      displayName: 'Message ID',
      description: 'The message ID to retrieve (UUID returned when sending)',
      required: true,
    }),
  },
  async run(context) {
    const id = context.propsValue.id;

    const res = await httpClient.sendRequest({
      method: HttpMethod.GET,
      url: `https://api.transmitmessage.com/v2/sms/${id}`,
      headers: {
        'x-api-key': `${context.auth.props.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return res;
  },
});

