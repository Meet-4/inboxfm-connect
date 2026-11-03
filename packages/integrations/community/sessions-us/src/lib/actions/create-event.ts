import { baseUrl, getTimezones, slugify } from '../common';
import { sessionAuth } from '../..';
import {
  HttpMethod,
  httpClient,
  HttpRequest,
} from '@inboxfm-connect/pieces-common';
import { Property, createAction } from '@inboxfm-connect/pieces-framework';

export const createEvent = createAction({
  auth: sessionAuth,
  name: 'create_event',
  displayName: 'Create Event',
  description: 'Quickly create an event.\n\nDEPRECATED (Nov 2026 liveness census): The API host api.app.sessions.us no longer resolves (NXDOMAIN confirmed on multiple resolvers) and sessions.us is offline, so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Create a new event on Sessions.us with a name, start/end time, and timezone. Use when an agent needs to schedule an event (a public, registration-based gathering, as opposed to a private session). Creates a new event each call, so it is not idempotent — repeating it produces duplicate events.', idempotent: false },
  props: {
    name: Property.ShortText({
      displayName: 'Event Name',
      description: 'The name of the event',
      required: true,
    }),
    startAt: Property.DateTime({
      displayName: 'Starts At',
      description: 'Select a date and time',
      required: true,
      defaultValue: new Date().toISOString(),
    }),
    plannedEnd: Property.DateTime({
      displayName: 'Ends At',
      description: 'Select a date and time',
      required: true,
      defaultValue: new Date().toISOString(),
    }),
    timezone: Property.Dropdown({
      auth: sessionAuth,
      displayName: 'Timezone',
      description: 'The timezone which the session will take place.',
      required: true,
      refreshers: [],
      options: async () => {
        const timezones = await getTimezones();

        return {
          options: timezones.map((timezone) => {
            return {
              label: timezone,
              value: timezone,
            };
          }),
        };
      },
    }),
  },

  async run({ propsValue, auth }) {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `${baseUrl}/events`,
      headers: {
        'x-api-key': auth.secret_text,
      },
      body: {
        name: propsValue['name'],
        slug: slugify(propsValue['name']),
        startAt: propsValue['startAt'],
        plannedEnd: propsValue['plannedEnd'],
        timeZone: propsValue['timezone'],
      },
    };

    const response = await httpClient.sendRequest(request);
    return response.body;
  },
});
