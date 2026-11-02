import {
  httpClient,
  HttpMethod,
  AuthenticationType,
} from '@inboxfm-connect/pieces-common';
import { PieceAuth, Property } from '@inboxfm-connect/pieces-framework';

export const senderAuth = PieceAuth.SecretText({
  displayName: 'API Token',
  description: 'Enter your Sender API Token',
  required: true,
});

const SENDER_API_BASE_URL = 'https://api.sender.net/v2';

export async function makeSenderRequest(
  auth: string,
  endpoint: string,
  method: HttpMethod = HttpMethod.GET,
  body?: any
) {
  return await httpClient.sendRequest({
    method,
    url: `${SENDER_API_BASE_URL}${endpoint}`,
    headers: {
      Authorization: `Bearer ${auth}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body,
  });
}
// Sender paginates every list endpoint with `page` and `limit`
// (limit of 10 by default, up to 100) and reports whether more pages
// remain via `has_more_resources` in the response body — a single call
// silently capped every dropdown at the first small page.
// https://api.sender.net/
const SENDER_PAGE_SIZE = 100;
const SENDER_MAX_PAGES = 10;

async function fetchSenderPaged(
  auth: string,
  baseEndpoint: string
): Promise<{ items: any[]; truncated: boolean }> {
  const items: any[] = [];
  const joiner = baseEndpoint.includes('?') ? '&' : '?';

  for (let page = 1; page <= SENDER_MAX_PAGES; page++) {
    const response: any = await makeSenderRequest(
      auth,
      `${baseEndpoint}${joiner}page=${page}&limit=${SENDER_PAGE_SIZE}`,
      HttpMethod.GET
    );
    const batch = response.body?.data || [];
    items.push(...batch);

    if (!response.body?.has_more_resources || batch.length < SENDER_PAGE_SIZE) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}

export const groupIdDropdown = Property.Dropdown({
  auth: senderAuth,
  displayName: 'Groups',
  description: 'Select one or more groups',
  required: false,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your Sender account first',
      };
    }

    try {
      const { items: groups, truncated } = await fetchSenderPaged(
        auth.secret_text,
        '/groups'
      );
      const options = groups.map((group: any) => ({
        label: group.title,
        value: group.id,
      }));
      if (truncated) {
        options.push({
          label: '⚠️ Could not load all groups (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading groups',
      };
    }
  },
});

export const groupIdsDropdown = Property.MultiSelectDropdown({
  auth: senderAuth,
  displayName: 'Groups',
  description: 'Select one or more groups',
  required: false,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your Sender account first',
      };
    }

    try {
      const { items: groups, truncated } = await fetchSenderPaged(
        auth.secret_text,
        '/groups'
      );
      const options = groups.map((group: any) => ({
        label: group.title,
        value: group.id,
      }));
      if (truncated) {
        options.push({
          label: '⚠️ Could not load all groups (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading groups',
      };
    }
  },
});

export const subscribersDropdown = Property.MultiSelectDropdown<string, true, typeof senderAuth>({
  auth: senderAuth,
  displayName: 'Subscribers',
  description: 'Select one or more subscribers to delete',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your Sender account first',
      };
    }

    try {
      const { items: subscribers, truncated } = await fetchSenderPaged(
        auth.secret_text,
        '/subscribers'
      );
      const options = subscribers.map((sub: any) => ({
        label: sub.email,
        value: sub.email,
      }));
      if (truncated) {
        options.push({
          label: '⚠️ Could not load all subscribers (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading subscribers',
      };
    }
  },
});

export const subscriberDropdownSingle = Property.Dropdown<string, true, typeof senderAuth>({
  auth: senderAuth,
  displayName: 'Subscriber',
  description: 'Select a subscriber',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your Sender account first',
      };
    }

    try {
      const { items: subscribers, truncated } = await fetchSenderPaged(
        auth.secret_text,
        '/subscribers'
      );
      const options = subscribers.map((sub: any) => ({
        label: sub.email,
        value: sub.email,
      }));
      if (truncated) {
        options.push({
          label: '⚠️ Could not load all subscribers (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading subscribers',
      };
    }
  },
});

export const campaignDropdown = Property.Dropdown({
  auth: senderAuth,
    displayName: 'Campaign',
  description: 'Select a campaign',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your Sender account first',
      };
    }

    try {
      const { items: campaigns, truncated } = await fetchSenderPaged(
        auth.secret_text,
        '/campaigns?status=DRAFT'
      );
      const options = campaigns.map((c: any) => ({
        label: c.title || c.subject || c.id,
        value: c.id,
      }));
      if (truncated) {
        options.push({
          label: '⚠️ Could not load all draft campaigns (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading campaigns',
      };
    }
  },
});
