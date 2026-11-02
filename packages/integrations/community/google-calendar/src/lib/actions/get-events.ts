import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import {
  HttpRequest,
  HttpMethod,
  AuthenticationType,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import { googleCalendarCommon, googleCalendarAuth, getAccessToken } from '../common';
import dayjs from 'dayjs';
import { getEventsActionOutputSchema } from '../output-schemas';

export const getEvents = createAction({
  auth: googleCalendarAuth,
  name: 'google_calendar_get_events',
  description:
    'Get Events. Follows Google Calendar pagination (up to 2500 events per page, up to 10000 events) and merges the pages.',
  audience: 'both',
  aiMetadata: { description: 'Lists events from a Google Calendar, optionally filtered by a date range, search term, and event types, and can expand recurring events into individual instances. Follows Google Calendar pagination (up to 2500 events per page, up to 10000 events) and merges the pages. Use to look up or browse multiple events when you do not already have a specific event ID; use Get Event by ID for a single known event. Read-only and idempotent.', idempotent: true },
  displayName: 'Get all Events',
  props: {
    calendar_id: googleCalendarCommon.calendarDropdown('writer'),
    event_types: Property.StaticMultiSelectDropdown({
      displayName: 'Event types',
      description: 'Select event types',
      required: true,
      defaultValue: ['default', 'focusTime', 'outOfOffice'],
      options: {
        options: [
          {
            label: 'Default',
            value: 'default',
          },
          {
            label: 'Out Of Office',
            value: 'outOfOffice',
          },
          {
            label: 'Focus Time',
            value: 'focusTime',
          },
          {
            label: 'Working Location',
            value: 'workingLocation',
          },
        ],
      },
    }),
    search: Property.ShortText({
      displayName: 'Search Term',
      required: false,
    }),
    start_date: Property.DateTime({
      displayName: 'Date from',
      required: false,
    }),
    end_date: Property.DateTime({
      displayName: 'Date to',
      required: false,
    }),
    singleEvents: Property.Checkbox({
			displayName: 'Expand Recurring Event?',
      description: "Whether to expand recurring events into instances and only return single one-off events and instances of recurring events, but not the underlying recurring events themselves.",
			required: true,
			defaultValue: false,
		}),
  },
  outputSchema: getEventsActionOutputSchema,
  async run(configValue) {
    // docs: https://developers.google.com/calendar/api/v3/reference/events/list
    const {
      calendar_id: calendarId,
      start_date,
      end_date,
      search,
      event_types,
      singleEvents,
    } = configValue.propsValue;
    const token = await getAccessToken(configValue.auth);
    const queryParams: Record<string, string> = { showDeleted: 'false' };
    let url = `${googleCalendarCommon.baseUrl}/calendars/${calendarId}/events`;

    if(singleEvents !== null) {
      queryParams['singleEvents'] = singleEvents ? 'true' : 'false';
    }

    if (search) {
      queryParams['q'] = `"${search}"`;
    }

    // date range
    if (start_date) {
      queryParams['timeMin'] = dayjs(start_date).format(
        'YYYY-MM-DDTHH:mm:ss.sssZ'
      );
    }
    if (start_date && end_date) {
      queryParams['timeMax'] = dayjs(end_date).format(
        'YYYY-MM-DDTHH:mm:ss.sssZ'
      );
    }
    // filter by event type
    if (event_types.length > 0) {
      url += `?${event_types.map((type) => `eventTypes=${type}`).join('&')}`;
    }
    const request: HttpRequest<Record<string, unknown>> = {
      method: HttpMethod.GET,
      url,
      queryParams: {
        ...queryParams,
        // Google Calendar returns 250 events by page; 2500 is the maximum.
        maxResults: '2500',
      },
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token,
      },
    };
    const response = await httpClient.sendRequest<Record<string, unknown>>(
      request
    );

    // events.list paginates via nextPageToken, so a single request can miss
    // events beyond the first page. Walk pages so they are not silently
    // dropped (bounded walk).
    const MAX_PAGES = 4; // at most 2500 events per page -> 10000 events per run
    const items: unknown[] = [...((response.body as any)?.items ?? [])];
    let nextPageToken = (response.body as any)?.nextPageToken;

    for (let page = 2; nextPageToken && page <= MAX_PAGES; page++) {
      const pageRequest: HttpRequest<Record<string, unknown>> = {
        ...request,
        queryParams: {
          ...(request.queryParams ?? {}),
          pageToken: nextPageToken as string,
        },
      };

      const pageResponse = await httpClient.sendRequest<
        Record<string, unknown>
      >(pageRequest);

      items.push(...(((pageResponse.body as any)?.items ?? []) as unknown[]));
      nextPageToken = (pageResponse.body as any)?.nextPageToken;
    }

    if (response.body) {
      response.body['items'] = items;
      if (nextPageToken) {
        response.body['nextPageToken'] = nextPageToken;
      } else {
        delete response.body['nextPageToken'];
      }
    }

    return response;
  },
});

