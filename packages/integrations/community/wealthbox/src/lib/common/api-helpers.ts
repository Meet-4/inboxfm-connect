import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { WEALTHBOX_API_BASE } from './constants';

// Wealthbox paginates all list endpoints with the `page` and `per_page`
// query parameters (default 25 per page, 1-based pages), so a single
// unparameterized call silently caps the result at the first 25 records.
// https://dev.wealthbox.com/
const WB_PAGE_SIZE = 50;
const WB_MAX_PAGES = 10;

async function fetchWealthboxPaged<T = any>(
  path: string,
  listKey: string,
  auth: string,
  extraParams: Record<string, string> = {}
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];

  for (let page = 1; page <= WB_MAX_PAGES; page++) {
    const params = new URLSearchParams({
      ...extraParams,
      per_page: String(WB_PAGE_SIZE),
      page: String(page),
    });

    const response = await httpClient.sendRequest({
      method: HttpMethod.GET,
      url: `${WEALTHBOX_API_BASE}${path}?${params.toString()}`,
      headers: {
        'ACCESS_TOKEN': auth,
        'Content-Type': 'application/json'
      }
    });

    if (response.status >= 400) {
      throw new Error(`Failed to fetch ${listKey}: ${response.status}`);
    }

    const batch = (response.body as Record<string, T[]>)?.[listKey] || [];
    items.push(...batch);

    if (batch.length < WB_PAGE_SIZE) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}

// Maps a paged Wealthbox response into dropdown options and appends the
// standard truncation notice when the page budget was exhausted.
export function wealthboxOptions<TItem, TValue>(
  page: { items: TItem[]; truncated: boolean },
  resourceLabel: string,
  toOption: (item: TItem) => { label: string; value: TValue }
): { label: string; value: TValue }[] {
  const options = page.items.map(toOption);
  if (page.truncated) {
    options.push({
      label: `⚠️ Could not load all ${resourceLabel} (partial list)`,
      value: '__truncated_notice__' as unknown as TValue,
    });
  }
  return options;
}

export const fetchUserGroups = async (auth: string) => {
  return fetchWealthboxPaged('/user_groups', 'user_groups', auth);
};

export const fetchContacts = async (auth: string, filters?: { active?: boolean; order?: string }) => {
  const extraParams: Record<string, string> = {};
  if (filters?.active !== undefined) extraParams['active'] = filters.active.toString();
  if (filters?.order) extraParams['order'] = filters.order;
  return fetchWealthboxPaged('/contacts', 'contacts', auth, extraParams);
};

export const fetchTags = async (auth: string, documentType?: string) => {
  return fetchWealthboxPaged(
    '/categories/tags',
    'tags',
    auth,
    documentType ? { document_type: documentType } : {}
  );
};

export const fetchUsers = async (auth: string) => {
  return fetchWealthboxPaged('/users', 'users', auth);
};

export const fetchCustomFields = async (auth: string, documentType?: string) => {
  return fetchWealthboxPaged(
    '/categories/custom_fields',
    'custom_fields',
    auth,
    documentType ? { document_type: documentType } : {}
  );
};

export const fetchEventCategories = async (auth: string) => {
  return fetchWealthboxPaged('/event_categories', 'event_categories', auth);
};

export const fetchHouseholds = async (auth: string) => {
  return fetchWealthboxPaged('/contacts', 'contacts', auth, {
    type: 'Household',
    active: 'true',
  });
};

export const fetchOpportunityStages = async (auth: string) => {
  return fetchWealthboxPaged('/opportunity_stages', 'opportunity_stages', auth);
};

export const fetchTaskCategories = async (auth: string) => {
  return fetchWealthboxPaged('/task_categories', 'task_categories', auth);
};

export const fetchOpportunities = async (auth: string) => {
  return fetchWealthboxPaged('/opportunities', 'opportunities', auth);
};

export const fetchProjects = async (auth: string) => {
  return fetchWealthboxPaged('/projects', 'projects', auth);
};

export const fetchWorkflowTemplates = async (auth: string) => {
  return fetchWealthboxPaged('/workflow_templates', 'workflow_templates', auth);
};

export const fetchTasks = async (auth: string, filters?: {
  resource_id?: number;
  resource_type?: string;
  assigned_to?: number;
  completed?: boolean;
  task_type?: string;
  updated_since?: string;
  updated_before?: string;
  limit?: number;
}) => {
  const params = new URLSearchParams();

  if (filters?.resource_id) params.append('resource_id', filters.resource_id.toString());
  if (filters?.resource_type) params.append('resource_type', filters.resource_type);
  if (filters?.assigned_to) params.append('assigned_to', filters.assigned_to.toString());
  if (filters?.completed !== undefined) params.append('completed', filters.completed.toString());
  if (filters?.task_type) params.append('task_type', filters.task_type);
  if (filters?.updated_since) params.append('updated_since', filters.updated_since);
  if (filters?.updated_before) params.append('updated_before', filters.updated_before);
  if (filters?.limit) params.append('limit', filters.limit.toString());

  const url = `${WEALTHBOX_API_BASE}/tasks${params.toString() ? '?' + params.toString() : ''}`;

  const response = await httpClient.sendRequest({
    method: HttpMethod.GET,
    url,
    headers: {
      'ACCESS_TOKEN': auth,
      'Content-Type': 'application/json'
    }
  });

  if (response.status >= 400) {
    throw new Error(`Failed to fetch tasks: ${response.status}`);
  }

  return response.body.tasks || [];
};

export const createApiHeaders = (auth: string) => ({
  'ACCESS_TOKEN': auth,
  'Content-Type': 'application/json'
});

export const handleApiError = (operation: string, status: number, body?: any) => {
  throw new Error(`Wealthbox API error in ${operation}: ${status} - ${JSON.stringify(body)}`);
};
