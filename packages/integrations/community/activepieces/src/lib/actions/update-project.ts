import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import {
  AuthenticationType,
  httpClient,
  HttpMethod,
} from '@inboxfm-connect/pieces-common';
import { activePieceAuth } from '../auth';

export const updateProject = createAction({
  name: 'update_project',
  auth: activePieceAuth,
  displayName: 'Update Project',
  description: 'Update a project',
  audience: 'both',
  aiMetadata: {
    description:
      'Update an existing project on an Activepieces platform, identified by its project id, setting its display name and whether the project owner is notified by email when flows fail. Use when reconfiguring a known project rather than creating one. Requires the target project id; idempotent — repeating with the same values leaves the project in the same state.',
    idempotent: true,
  },
  props: {
    id: Property.ShortText({
      displayName: 'Id',
      description: 'Id of the project',
      required: true,
    }),
    display_name: Property.ShortText({
      displayName: 'Display Name',
      description: undefined,
      required: true,
    }),
    notify_status: Property.StaticDropdown({
      displayName: 'Notify Status',
      description:
        'Whether the project owner is notified by email when flows fail',
      required: true,
      options: {
        options: [
          {
            label: 'Always notify',
            value: 'ALWAYS',
          },
          {
            label: 'Never notify',
            value: 'NEVER',
          },
        ],
      },
    }),
  },
  async run({ propsValue, auth }) {
    const response = await httpClient.sendRequest<string[]>({
      method: HttpMethod.POST,
      url: `${auth.props.baseApiUrl}/projects/${propsValue['id']}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.props.apiKey,
      },
      body: {
        displayName: propsValue['display_name'],
        notifyFlowOwnerOnFailure: propsValue['notify_status'] === 'ALWAYS',
      },
    });

    return response.body;
  },
});

