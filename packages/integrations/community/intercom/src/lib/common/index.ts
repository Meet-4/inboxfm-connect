import { getAccessTokenOrThrow } from '@inboxfm-connect/pieces-common';
import { IntercomClient } from 'intercom-client';
import {
  AppConnectionValueForAuthProperty,
  DropdownOption,
  Property,
} from '@inboxfm-connect/pieces-framework';
import { AppConnectionType } from '@inboxfm-connect/pieces-framework';
import { intercomAuth } from '../auth';

export type IntercomAuthValue = AppConnectionValueForAuthProperty<
  typeof intercomAuth
>;

export function getIntercomToken(auth: IntercomAuthValue): string {
  if (auth.type === AppConnectionType.CUSTOM_AUTH) {
    return auth.props.accessToken;
  }
  return getAccessTokenOrThrow(auth);
}

export function getIntercomRegion(auth: IntercomAuthValue): string {
  if (auth.type === AppConnectionType.CUSTOM_AUTH) {
    return auth.props.region;
  }
  return (auth.props?.['region'] as string) ?? 'intercom';
}

export const intercomClient = (auth: IntercomAuthValue) => {
  const client = new IntercomClient({
    token: getIntercomToken(auth),
    environment: `https://api.${getIntercomRegion(auth)}.io`,
  });
  return client;
};

export const commonProps = {
  admins: <R extends boolean>(options: { displayName: string; required: R }) =>
    Property.Dropdown<string, R, typeof intercomAuth>({
      auth: intercomAuth,
      displayName: options.displayName,
      required: options.required,
      options: async ({ auth }) => {
        if (!auth) {
          return {
            options: [],
            disabled: true,
            placeholder: 'Please connect your account first',
          };
        }
        const client = intercomClient(auth as IntercomAuthValue);
        const adminsResponse = await client.admins.list();

        return {
          options: adminsResponse.admins.map((c) => {
            const res = { value: c.id, label: '' };
            if (c.name) {
              res.label = c.name;
            } else if (c.email) {
              res.label = c.email;
            } else {
              res.label = c.id;
            }
            return res;
          }),
        };
      },
      refreshers: [],
    }),
  contacts: <R extends boolean>(options: {
    displayName: string;
    required: R;
  }) =>
    Property.Dropdown<string, R, typeof intercomAuth>({
      auth: intercomAuth,
      displayName: options.displayName,
      required: options.required,
      options: async ({ auth }) => {
        if (!auth) {
          return {
            options: [],
            disabled: true,
            placeholder: 'Please connect your account first',
          };
        }
        const client = intercomClient(auth);

        // Intercom paginates GET /contacts (default 10 per page, per_page max
        // 150, starting_after cursor). Reading only `.data` returns the first
        // page, so walk the SDK's async iterable (which follows the
        // pages.next.starting_after cursor) with a bounded budget.
        // https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts/listcontacts
        const PAGE_SIZE = 150;
        const MAX_ITEMS = PAGE_SIZE * 10;

        const response = await client.contacts.list({
          per_page: PAGE_SIZE,
        });

        const options: DropdownOption<string>[] = [];
        let truncated = false;
        let loaded = 0;

        for await (const c of response) {
          options.push({
            value: c.id,
            label: c.name || c.email || c.id,
          });
          loaded++;
          if (loaded >= MAX_ITEMS) {
            truncated = true;
            break;
          }
        }

        if (truncated) {
          options.push({
            label: '⚠️ Could not load all contacts (partial list)',
            value: '__truncated_notice__',
          });
        }

        return {
          options,
        };
      },
      refreshers: [],
    }),
};

export type Operator =
  | '='
  | '!='
  | 'IN'
  | 'NIN'
  | '<'
  | '>'
  | '~'
  | '!~'
  | '^'
  | '$';

export type TriggerPayload = {
  type: string;
  app_id: string;
  id: string;
  topic: string;
  data: {
    type: string;
    item: Record<string, any>;
  };
};

