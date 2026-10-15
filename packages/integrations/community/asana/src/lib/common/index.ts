import { Property, OAuth2PropertyValue } from '@inboxfm-connect/pieces-framework';
import {
  getAccessTokenOrThrow,
  HttpMethod,
  HttpMessageBody,
  HttpResponse,
  httpClient,
  AuthenticationType,
} from '@inboxfm-connect/pieces-common';
import { asanaAuth } from '../auth';

export const asanaCommon = {
  workspace: Property.Dropdown({
    auth: asanaAuth,
    description: 'Asana workspace to create the task in',
    displayName: 'Workspace',
    required: true,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          placeholder: 'connect your account first',
          options: [],
        };
      }
      const accessToken = getAccessTokenOrThrow(auth as OAuth2PropertyValue);
      const workspaces = await fetchAllAsanaPages<{
        gid: string;
        name: string;
      }>(HttpMethod.GET, 'workspaces', accessToken);
      return {
        disabled: false,
        options: workspaces.map((workspace) => {
          return {
            label: workspace.name,
            value: workspace.gid,
          };
        }),
      };
    },
  }),
  project: Property.Dropdown({
    auth: asanaAuth,
    description: 'Asana Project to create the task in',
    displayName: 'Project',
    required: true,
    refreshers: ['workspace'],
    options: async ({ auth, workspace }) => {
      if (!auth) {
        return {
          disabled: true,
          placeholder: 'connect your account first',
          options: [],
        };
      }
      if (!workspace) {
        return {
          disabled: true,
          placeholder: 'Select workspace first',
          options: [],
        };
      }
      const accessToken = getAccessTokenOrThrow(auth as OAuth2PropertyValue);
      const projects = await fetchAllAsanaPages<{
        gid: string;
        name: string;
      }>(HttpMethod.GET, 'projects?workspace=' + workspace, accessToken);
      return {
        disabled: false,
        options: projects.map((project) => {
          return {
            label: project.name,
            value: project.gid,
          };
        }),
      };
    },
  }),
  assignee: Property.Dropdown<string,false,typeof asanaAuth>({
    auth: asanaAuth,
    description: 'Assignee for the task',
    displayName: 'Assignee',
    required: false,
    refreshers: ['workspace'],
    options: async ({ auth, workspace }) => {
      if (!auth) {
        return {
          disabled: true,
          placeholder: 'connect your account first',
          options: [],
        };
      }
      if (!workspace) {
        return {
          disabled: true,
          placeholder: 'Select workspace first',
          options: [],
        };
      }
      const accessToken = getAccessTokenOrThrow(auth as OAuth2PropertyValue);
      const users = await getUsers(accessToken, workspace as string);
      return {
        disabled: false,
        options: users.map((user) => {
          return {
            label: user.name,
            value: user.gid,
          };
        }),
      };
    },
  }),
  tags: Property.MultiSelectDropdown<string,false,typeof asanaAuth>({
    auth: asanaAuth,
    description: 'Tags to add to the task',
    displayName: 'Tags',
    required: false,
    refreshers: ['workspace'],
    options: async ({ auth, workspace }) => {
      if (!auth) {
        return {
          disabled: true,
          placeholder: 'connect your account first',
          options: [],
        };
      }
      if (!workspace) {
        return {
          disabled: true,
          placeholder: 'Select workspace first',
          options: [],
        };
      }
      const accessToken = getAccessTokenOrThrow(auth as OAuth2PropertyValue);
      const response = await getTags(accessToken, workspace as string);
      return {
        disabled: false,
        options: response.map((project) => {
          return {
            label: project.name,
            value: project.gid,
          };
        }),
      };
    },
  }),
};

export async function getUsers(
  accessToken: string,
  workspace: string
): Promise<
  {
    gid: string;
    name: string;
  }[]
> {
  return await getAsanaPagedList<{ gid: string; name: string }>(
    'users?workspace=' + workspace,
    accessToken
  );
}

export async function getTags(
  accessToken: string,
  workspace: string
): Promise<
  {
    gid: string;
    name: string;
  }[]
> {
  return await getAsanaPagedList<{ gid: string; name: string }>(
    'workspaces/' + workspace + '/tags',
    accessToken
  );
}

type AsanaPaginatedList<T> = {
  data: T[];
  next_page?: { offset: string; path: string; uri: string } | null;
};

/**
 * Fetches every page of an Asana list endpoint. Asana only returns a
 * `next_page` object (with the `offset` token for the next request) once
 * pagination is enabled via the `limit` parameter (max 100); without it,
 * results may be truncated server-side.
 * https://developers.asana.com/docs/pagination
 */
async function getAsanaPagedList<T>(
  apiUrl: string,
  accessToken: string
): Promise<T[]> {
  const items: T[] = [];
  const firstPageUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}limit=100`;
  let nextOffset: string | undefined;
  do {
    const url = nextOffset
      ? `${firstPageUrl}&offset=${encodeURIComponent(nextOffset)}`
      : firstPageUrl;
    const body = (
      await callAsanaApi<AsanaPaginatedList<T>>(
        HttpMethod.GET,
        url,
        accessToken,
        undefined
      )
    ).body;
    if (Array.isArray(body?.data)) {
      items.push(...body.data);
    }
    nextOffset = body?.next_page?.offset;
  } while (nextOffset);
  return items;
}

export async function callAsanaApi<T extends HttpMessageBody = any>(
  method: HttpMethod,
  apiUrl: string,
  accessToken: string,
  body: any | undefined
): Promise<HttpResponse<T>> {
  return await httpClient.sendRequest<T>({
    method: method,
    url: `https://app.asana.com/api/1.0/${apiUrl}`,
    authentication: {
      type: AuthenticationType.BEARER_TOKEN,
      token: accessToken,
    },
    body: body,
  });
}

type AsanaPaginatedResponse<T> = {
  data: T[];
  next_page?: { offset: string; path: string; uri: string } | null;
};

/**
 * Fetches every page of an Asana list endpoint. Asana only returns a
 * `next_page` object (with the `offset` token for the next request) once
 * pagination is enabled via the `limit` parameter (max 100); without it,
 * results may be truncated server-side.
 * https://developers.asana.com/docs/pagination
 */
export async function fetchAllAsanaPages<T>(
  method: HttpMethod,
  apiUrl: string,
  accessToken: string
): Promise<T[]> {
  const items: T[] = [];
  const firstPageUrl = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}limit=100`;
  let nextOffset: string | undefined;
  do {
    const url = nextOffset
      ? `${firstPageUrl}&offset=${encodeURIComponent(nextOffset)}`
      : firstPageUrl;
    const body = (
      await callAsanaApi<AsanaPaginatedResponse<T>>(
        method,
        url,
        accessToken,
        undefined
      )
    ).body;
    if (Array.isArray(body?.data)) {
      items.push(...body.data);
    }
    nextOffset = body?.next_page?.offset;
  } while (nextOffset);
  return items;
}

