import { zagomailAuth } from '../auth';
import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { zagoMailApiService } from '../common/request';
import { listUId } from '../common/props';

export const searchSubscriberByEmail = createAction({
  auth: zagomailAuth,
  name: 'searchSubscriberByEmail',
  displayName: 'Search Subscriber',
  description: 'Finds a subscriber by their email address.\n\nDEPRECATED (Nov 2026 liveness census): The API hosts api.zagomail.com and app.zagomail.com no longer resolve (NXDOMAIN confirmed on multiple resolvers), so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Looks up a subscriber in a specific Zagomail list by exact email address, returning whether a match was found along with the record. Use to check membership or resolve a subscriber UID before tagging or updating. Read-only and idempotent; requires the list UID and email.', idempotent: true },
  props: {
    listUId: listUId,
    email: Property.ShortText({
      displayName: 'Email',
      required: true,
    }),
  },
  async run({ propsValue, auth }) {
    const listUId = propsValue.listUId;
    const email = propsValue.email;

    const response = await zagoMailApiService.searchSubscriberByEmail(
      auth.secret_text,
      listUId,
      {
        email,
      }
    );

    return {
      found: response.status === 'success',
      result: response.data ?? null,
    };
  },
});
