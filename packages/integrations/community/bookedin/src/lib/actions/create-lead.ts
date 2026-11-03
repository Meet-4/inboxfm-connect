import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { bookedinAuth } from '../auth';
import { BASE_URL, getBookedinHeaders, extractApiKey } from '../common/props';

export const createLead = createAction({
  name: 'createLead',
  displayName: 'Create Lead',
  description: 'Creates a new lead in Bookedin AI\n\nDEPRECATED (Nov 2026 liveness census): The API host api.bookedin.ai no longer resolves (NXDOMAIN confirmed on multiple resolvers) and Bookedin has published no replacement API, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Create a new lead in Bookedin for the authenticated business from a contact first name, last name, email, and phone (all required). Use it to add a prospect into the lead pipeline. Not idempotent — each call creates a separate lead, with no de-duplication on email or phone.', idempotent: false },
  auth: bookedinAuth,
  props: {
    firstName: Property.ShortText({
      displayName: 'First Name',
      required: true,
    }),
    lastName: Property.ShortText({
      displayName: 'Last Name',
      required: true,
    }),
    email: Property.ShortText({
      displayName: 'Email',
      required: true,
    }),
    phone: Property.ShortText({
      displayName: 'Phone Number',
      required: true,
    }),
  },
  async run({ auth, propsValue }) {
    const apiKey = extractApiKey(auth);

    const payload = {
      contact: {
        name: {
          last: propsValue.lastName,
          first: propsValue.firstName,
        },
        email: propsValue.email,
        number: propsValue.phone,
      },
    };

    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: `${BASE_URL}/leads/`,
      headers: {
        ...getBookedinHeaders(apiKey),
        'Content-Type': 'application/json',
      },
      body: payload,
    });

    return response.body;
  },
});
