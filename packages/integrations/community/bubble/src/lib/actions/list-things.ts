import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import {
  AuthenticationType,
  httpClient,
  HttpMethod,
} from '@inboxfm-connect/pieces-common';

import { bubbleAuth } from '../auth';
import { bubbleCommon } from '../common';

export const bubbleListThingsAction = createAction({
  auth: bubbleAuth,
  name: 'bubble_list_things',
  displayName: 'List Thing',
  description: 'List things by type',
  audience: 'both',
  aiMetadata: { description: 'Search and list records ("things") of a given data type in a Bubble app via the Bubble Data API, filtering by a single constraint (e.g. equals, text contains, greater/less than, in, empty, geographic_search) on a chosen field and value, with cursor and limit for pagination. Use to find records matching a condition or to page through a type. Read-only and idempotent.', idempotent: true },
  props: {
    typename: bubbleCommon.typename,
    constraint: Property.StaticDropdown({
      displayName: 'Constraint',
      required: true,
      options: {
        options: [
          {
            label: 'equals',
            value: 'equals',
          },
          {
            label: 'not equal',
            value: 'not equal',
          },
          {
            label: 'text contains',
            value: 'text contains',
          },
          {
            label: 'not text contains',
            value: 'not text contains',
          },
          {
            label: 'greater than',
            value: 'greater than',
          },
          {
            label: 'less than',
            value: 'less than',
          },
          {
            label: 'in',
            value: 'in',
          },
          {
            label: 'not in',
            value: 'not in',
          },
          {
            label: 'contains',
            value: 'contains',
          },
          {
            label: 'not contains',
            value: 'not contains',
          },
          {
            label: 'empty',
            value: 'empty',
          },
          {
            label: 'not empty',
            value: 'not empty',
          },
          {
            label: 'geographic_search',
            value: 'geographic_search',
          },
        ],
      },
    }),
    field: Property.ShortText({
      displayName: 'Field',
      required: true,
    }),
    value: Property.ShortText({
      displayName: 'Value',
      required: true,
    }),
    cursor: Property.Number({
      displayName: 'Start from',
      required: true,
    }),

    limit: Property.Number({
      displayName: 'Limit',
      required: true,
    }),
  },
  async run(context) {
    const { appname, token } = context.auth.props;
    const { typename, constraint, field, value, cursor, limit } =
      context.propsValue;

    const server_url = `https://${appname}.bubbleapps.io/api/1.1/obj/${typename}`;

    // Bubble's Data API takes search constraints as a URL-encoded JSON array
    // in the `constraints` query parameter on a GET request:
    // [{"key": "<field>", "constraint_type": "<type>", "value": "<value>"}]
    const constraints = JSON.stringify([
      {
        key: field,
        constraint_type: constraint,
        value: value,
      },
    ]);

    const response = await httpClient.sendRequest({
      method: HttpMethod.GET,
      url: server_url,
      headers: {
        'user-agent': 'activepieces',
        Authorization: `Bearer ${token}`,
      },
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token,
      },
      queryParams: {
        constraints: constraints,
        cursor: String(cursor),
        limit: String(limit),
      },
    });

    return response.body;
  },
});

