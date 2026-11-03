import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { makeRequest, transformCustomFields } from '../common/client';
import { campaignMonitorAuth } from '../auth';
import { clientId, listId } from '../common/props';

export const findSubscriberAction = createAction({
  auth: campaignMonitorAuth,
  name: 'find_subscriber',
  displayName: 'Find Subscriber',
  description: 'Find a subscriber by email in a specific list.',
  audience: 'both',
  aiMetadata: {
    description:
      'Looks up a single subscriber by exact email address within a specific Campaign Monitor list under a client, returning their details and tracking preference. Choose this to check whether a contact exists on a list or to read their state before adding/updating; a missing subscriber resolves as not found rather than an error. Read-only and idempotent.',
    idempotent: true,
  },
  props: {
    clientId: clientId,
    listId: listId,
    email: Property.ShortText({
      displayName: 'Email Address',
      description: 'The email address of the subscriber to find',
      required: true,
    }),
  },
  async run({ propsValue, auth }) {
    const { listId, email } = propsValue;

    try {
      const response = await makeRequest(
          { apiKey: auth.secret_text },
        HttpMethod.GET,
        `/subscribers/${listId}.json?email=${encodeURIComponent(
          email
        )}&includetrackingpreference=true`
      );

      return {
        found: true,
        result: {
            ...response.body,
            CustomFields:transformCustomFields(response.body['CustomFields'])
        },
      };
    } catch (error: any) {
      // Campaign Monitor signals a missing subscriber as HTTP 400 with body
      // Code 203 ("Subscriber Not In List"), not a 404 — see
      // https://www.campaignmonitor.com/api/subscribers/. Only that case is a
      // genuine miss; auth, rate-limit and server failures must surface.
      if (error?.response?.status === 400 && error?.response?.body?.Code === 203) {
        return {
          found: false,
          result: null,
        };
      }
      throw error;
    }
  },
});

