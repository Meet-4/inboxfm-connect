import { Property, OAuth2PropertyValue, DropdownOption } from '@inboxfm-connect/pieces-framework';
import {
  getAccessTokenOrThrow,
  HttpMethod,
  HttpMessageBody,
  HttpResponse,
  httpClient,
  AuthenticationType,
} from '@inboxfm-connect/pieces-common';
import { asanaAuth } from '../auth';

// Asana paginates collections with `limit` (1-100) + `next_page.offset`
// (https://developers.asana.com/docs/pagination). Bound the walk so a huge
// workspace can never hang the dropdown refresh, and surface truncation.
const MAX_PAGES = 50;

export const TRUNCATED_DROPDOWN_WARNING =
  '⚠️ Could not load all options (partial list)';

function addTruncationWarning(
  options: DropdownOption<string>[],
  truncated: boolean
): DropdownOption<string>[] {
  if (truncated) {
    options.push({
      label: TRUNCATED_DROPDOWN_WARNING,
      value: '__truncated_notice__',
    });
  }
  return options;
}

export async function fetchAllAsanaPages<T>(
  accessToken: string,
  apiUrl: string
): Promise<{ data: T[]; truncated: boolean }> {
  const results: T[] = [];
  let offset: string | undefined = undefined;
  let truncated = false;
  let pageCount = 0;

  // Asana only paginates an endpoint when a `limit` is provided, so always
  // request the maximum page size and walk `next_page.offset` while present.
  do {
    const separator = apiUrl.includes('?') ? '&' : '?';
    const requestUrl: string = `${apiUrl}${separator}limit=100${
      offset ? `&offset=${encodeURIComponent(offset)}` : ''
    }`;
    const response: HttpResponse<{
      data: T[];
      next_page?: { offset?: string } | null;
    }> = await callAsanaApi<{
      data: T[];
      next_page?: { offset?: string } | null;
    }>(HttpMethod.GET, requestUrl, accessToken, undefined);
    if (Array.isArray(response.body.data)) {
      results.push(...response.body.data);
    }
    offset = response.body.next_page?.offset ?? undefined;
    pageCount++;
    if (pageCount >= MAX_PAGES && offset) {
      truncated = true;
      break;
    }
  } while (offset);

  return { data: results, truncated };
}

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
      const { data, truncated } = await fetchAllAsanaPages<
        { gid: string; name: string }
      >(accessToken, 'workspaces');
      return {
        disabled: false,
        options: addTruncationWarning(
          data.map((workspace) => {
            return {
              label: workspace.name,
              value: workspace.gid,
            };
          }),
          truncated
        ),
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
      const { data, truncated } = await fetchAllAsanaPages<
        { gid: string; name: string }
      >(accessToken, 'projects?workspace=' + workspace);
      return {
        disabled: false,
        options: addTruncationWarning(
          data.map((project) => {
            return {
              label: project.name,
              value: project.gid,
            };
          }),
          truncated
        ),
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
      const { users, truncated } = await getUsers(
        accessToken,
        workspace as string
      );
      return {
        disabled: false,
        options: addTruncationWarning(
          users.map((user) => {
            return {
              label: user.name,
              value: user.gid,
            };
          }),
          truncated
        ),
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
      const { tags, truncated } = await getTags(
        accessToken,
        workspace as string
      );
      return {
        disabled: false,
        options: addTruncationWarning(
          tags.map((tag) => {
            return {
              label: tag.name,
              value: tag.gid,
            };
          }),
          truncated
        ),
      };
    },
  }),
};

export async function getUsers(
  accessToken: string,
  workspace: string
): Promise<{
  users: {
    gid: string;
    name: string;
  }[];
  truncated: boolean;
}> {
  const { data, truncated } = await fetchAllAsanaPages<
    { gid: string; name: string }
  >(accessToken, 'users?workspace=' + workspace);
  return { users: data, truncated };
}

export async function getTags(
  accessToken: string,
  workspace: string
): Promise<{
  tags: {
    gid: string;
    name: string;
  }[];
  truncated: boolean;
}> {
  const { data, truncated } = await fetchAllAsanaPages<
    { gid: string; name: string }
  >(accessToken, 'workspaces/' + workspace + '/tags');
  return { tags: data, truncated };
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
