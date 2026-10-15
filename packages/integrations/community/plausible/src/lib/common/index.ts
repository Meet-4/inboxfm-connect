import {
  AuthenticationType,
  httpClient,
  HttpMethod,
  HttpRequest,
} from '@inboxfm-connect/pieces-common';
import { Property } from '@inboxfm-connect/pieces-framework';
import { plausibleAuth } from '../..';

export const plausibleCommon = {
  baseUrl: 'https://plausible.io/api/v1',
};

export async function plausibleApiCall<T>({
  apiKey,
  method,
  endpoint,
  body,
  queryParams,
}: {
  apiKey: string;
  method: HttpMethod;
  endpoint: string;
  body?: unknown;
  queryParams?: Record<string, string>;
}): Promise<T> {
  const request: HttpRequest = {
    url: `${plausibleCommon.baseUrl}${endpoint}`,
    method,
    authentication: {
      type: AuthenticationType.BEARER_TOKEN,
      token: apiKey,
    },
    body,
    queryParams,
  };
  const response = await httpClient.sendRequest<T>(request);
  return response.body;
}

export async function plausibleListAll<T>({
  apiKey,
  endpoint,
  listKey,
  queryParams,
  maxPages = 100,
}: {
  apiKey: string;
  endpoint: string;
  listKey: string;
  queryParams?: Record<string, string>;
  maxPages?: number;
}): Promise<T[]> {
  // All Plausible list endpoints are cursor-paginated: they accept an `after`
  // cursor and return `meta.after` pointing at the next page (null when the
  // page just fetched is the last one). Docs: https://plausible.io/docs/sites-api
  // "The limit parameter must remain the same when paginating" — we never pass
  // a limit, so every page uses the default (100).
  const items: T[] = [];
  let after: string | null | undefined;
  let pages = 0;
  do {
    const response = await plausibleApiCall<Record<string, unknown>>({
      apiKey,
      method: HttpMethod.GET,
      endpoint,
      queryParams: after ? { ...(queryParams ?? {}), after } : queryParams,
    });
    const pageItems = response[listKey];
    if (Array.isArray(pageItems)) {
      items.push(...(pageItems as T[]));
    }
    after =
      (response as { meta?: { after?: string | null } }).meta?.after ?? null;
    pages++;
  } while (after && pages < maxPages);
  return items;
}

export async function getSites(apiKey: string) {
  return plausibleListAll<{ domain: string; timezone: string }>({
    apiKey,
    endpoint: '/sites',
    listKey: 'sites',
  });
}

export const siteIdDropdown = Property.Dropdown({
  displayName: 'Site',
  description: 'Select a site',
  required: true,
  auth: plausibleAuth,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account first',
        options: [],
      };
    }
    const sites = await getSites(auth.secret_text);
    return {
      disabled: false,
      options: sites.map((site) => ({
        label: site.domain,
        value: site.domain,
      })),
    };
  },
});

export async function getTeams(apiKey: string) {
  return plausibleListAll<{ id: string; name: string; api_available: boolean }>({
    apiKey,
    endpoint: '/sites/teams',
    listKey: 'teams',
  });
}

export const teamIdDropdown = Property.Dropdown({
  displayName: 'Team',
  description: 'Select a team',
  required: false,
  refreshers: [],
  auth: plausibleAuth,
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account first',
        options: [],
      };
    }
    const teams = await getTeams(auth.secret_text);
    return {
      disabled: false,
      options: teams
        .filter((team) => team.api_available)
        .map((team) => ({
          label: team.name,
          value: team.id,
        })),
    };
  },
});

export async function getGoals(apiKey: string, siteId: string) {
  return plausibleListAll<{
    id: string;
    goal_type: string;
    display_name: string;
    event_name: string | null;
    page_path: string | null;
  }>({
    apiKey,
    endpoint: '/sites/goals',
    listKey: 'goals',
    queryParams: { site_id: siteId },
  });
}

export const goalIdDropdown = Property.Dropdown({
  displayName: 'Goal',
  description: 'Select a goal',
  required: true,
  auth: plausibleAuth,
  refreshers: ['site_id'],
  options: async ({ auth, site_id }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account first',
        options: [],
      };
    }
    if (!site_id) {
      return {
        disabled: true,
        placeholder: 'Select a site first',
        options: [],
      };
    }
    const goals = await getGoals(auth.secret_text, site_id as string);
    return {
      disabled: false,
      options: goals.map((goal) => ({
        label: goal.display_name,
        value: goal.id,
      })),
    };
  },
});

export async function getCustomProperties(apiKey: string, siteId: string) {
  return plausibleListAll<{ property: string }>({
    apiKey,
    endpoint: '/sites/custom-props',
    listKey: 'custom_properties',
    queryParams: { site_id: siteId },
  });
}

export const customPropertyDropdown = Property.Dropdown({
  displayName: 'Custom Property',
  description: 'Select a custom property',
  required: true,
  auth: plausibleAuth,
  refreshers: ['site_id'],
  options: async ({ auth, site_id }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account first',
        options: [],
      };
    }
    if (!site_id) {
      return {
        disabled: true,
        placeholder: 'Select a site first',
        options: [],
      };
    }
    const props = await getCustomProperties(auth.secret_text, site_id as string);
    return {
      disabled: false,
      options: props.map((prop) => ({
        label: prop.property,
        value: prop.property,
      })),
    };
  },
});

export async function getGuests(apiKey: string, siteId: string) {
  return plausibleListAll<{ email: string; role: string; status: string }>({
    apiKey,
    endpoint: '/sites/guests',
    listKey: 'guests',
    queryParams: { site_id: siteId },
  });
}

export const guestEmailDropdown = Property.Dropdown({
  displayName: 'Guest',
  description: 'Select a guest',
  required: true,
  auth: plausibleAuth,
  refreshers: ['site_id'],
  options: async ({ auth, site_id }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account first',
        options: [],
      };
    }
    if (!site_id) {
      return {
        disabled: true,
        placeholder: 'Select a site first',
        options: [],
      };
    }
    const guests = await getGuests(auth.secret_text, site_id as string);
    return {
      disabled: false,
      options: guests.map((guest) => ({
        label: `${guest.email} (${guest.role})`,
        value: guest.email,
      })),
    };
  },
});
