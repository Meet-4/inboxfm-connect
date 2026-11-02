import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';
import { API_ENDPOINTS } from './constants';

async function fireHttpRequest({
  method,
  path,
  body,
  access_token
}: {
  method: HttpMethod;
  path: string;
  access_token: string;
  body?: unknown;
}) {
  return await httpClient
    .sendRequest({
      method,
      url: path,
      headers: {
        Accept: 'application/json',
        Authorization: `Zoho-oauthtoken ${access_token}`,
        'Content-Type': 'application/json',
      },
      body,
    })
    .then((res) => res.body)
    .catch((err) => {
      throw new Error(
        `Error in request to ${path}: ${err.message || JSON.stringify(err)}`
      );
    });
}

// Zoho Bigin v2 list endpoints return per_page records (200 by default)
// and an info block whose more_records flag reports whether further pages
// exist; pagination reaches up to 2000 records. The record dropdowns
// fetched a single page, so accounts with more than 200 records of a type
// silently lost the rest when picking a record. Walk pages at the
// documented maximum page size with a bounded budget and report
// truncation so dropdowns can surface a partial-list notice.
// https://www.zoho.com/bigin/help/developer/rest-api/pagination.html
const BIGIN_PER_PAGE = 200;
const BIGIN_MAX_PAGES = 10;

async function fetchBiginList(
  access_token: string,
  api_domain: string,
  endpoint: string,
  dataKey: 'data' | 'tags' | 'users'
) {
  const items: any[] = [];
  let info: any = undefined;
  let truncated = false;

  for (let page = 1; page <= BIGIN_MAX_PAGES; page++) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const response = await fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${endpoint}${separator}per_page=${BIGIN_PER_PAGE}&page=${page}`,
      access_token,
    });
    const body = (response ?? {}) as any;
    const pageItems = Array.isArray(body[dataKey]) ? body[dataKey] : [];
    items.push(...pageItems);
    if (body.info) {
      info = body.info;
    }
    if (body?.info?.more_records !== true) {
      break;
    }
    if (page === BIGIN_MAX_PAGES) {
      truncated = true;
    }
  }

  return { [dataKey]: items, info, truncated } as any;
}

export const biginApiService = {
  createWebhook: async (
    access_token: string,
    payload: any,
    api_domain: string
  ) => {
    const res = await fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.WEBHOOKS}`,
      body: payload,
      access_token,
    });

    return res;
  },
  deleteWebhook: async (
    access_token: string,
    api_domain: string,
    channel_id: string
  ) => {
    return fireHttpRequest({
      method: HttpMethod.DELETE,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.WEBHOOKS}?channel_ids=${channel_id}`,
      access_token,
    });
  },
  fetchUsers: async (
    access_token: string,
    api_domain: string,
    params?: { type?: string; page?: number; per_page?: number }
  ) => {
    const qs = new URLSearchParams();
    if (params?.type) qs.set('type', params.type);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.per_page) qs.set('per_page', String(params.per_page));
    const query = qs.toString();
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.USERS}${query ? `?${query}` : ''}`,
      access_token,
    });
  },
  fetchUsersPaged: async (access_token: string, api_domain: string) => {
    return fetchBiginList(
      access_token,
      api_domain,
      `${API_ENDPOINTS.USERS}?type=ActiveUsers`,
      'users'
    );
  },
  createCompany: async (
    access_token: string,
    api_domain: string,
    body: any
  ) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.COMPANIES}`,
      access_token,
      body,
    });
  },
  updateCompany: async (
    access_token: string,
    api_domain: string,
    body: any
  ) => {
    return fireHttpRequest({
      method: HttpMethod.PUT,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.COMPANIES}`,
      access_token,
      body,
    });
  },
  fetchCompanies: async (access_token: string, api_domain: string) => {
    return fetchBiginList(
      access_token,
      api_domain,
      `${API_ENDPOINTS.COMPANIES}?fields=Owner,Account_Name,Phone,Website,Tag,Description,Billing_Street,Billing_State,Billing_Country,Billing_Code`,
      'data'
    );
  },
  createContact: async (
    access_token: string,
    api_domain: string,
    body: any
  ) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.CONTACTS}`,
      access_token,
      body,
    });
  },
  updateContact: async (
    access_token: string,
    api_domain: string,
    body: any
  ) => {
    return fireHttpRequest({
      method: HttpMethod.PUT,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.CONTACTS}`,
      access_token,
      body,
    });
  },
  fetchTags: async (
    access_token: string,
    api_domain: string,
    module: string
  ) => {
    return fetchBiginList(
      access_token,
      api_domain,
      `${API_ENDPOINTS.TAGS}?module=${module}`,
      'tags'
    );
  },
  fetchContacts: async (access_token: string, api_domain: string) => {
    return fetchBiginList(
      access_token,
      api_domain,
      `${API_ENDPOINTS.CONTACTS}?fields=First_Name,Last_Name,Title,Email,Mobile,Email_Opt_Out,Owner,Account_Name,Tag,Description,Mailing_Street,Mailing_City,Mailing_State,Mailing_Country,Mailing_Zip`,
      'data'
    );
  },
  fetchPipelinesRecords: async (access_token: string, api_domain: string) => {
    return fetchBiginList(
      access_token,
      api_domain,
      `${API_ENDPOINTS.PIPELINES}?fields=Deal_Name,Stage,Owner,Description,Contact_Name,Account_Name,Amount,Closing_Date,Sub_Pipeline,Tag`,
      'data'
    );
  },
  createPipelineRecord: async (
    access_token: string,
    api_domain: string,
    body: any
  ) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.PIPELINES}`,
      access_token,
      body,
    });
  },
  updatePipelineRecord: async (
    access_token: string,
    api_domain: string,
    body: any
  ) => {
    return fireHttpRequest({
      method: HttpMethod.PUT,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.PIPELINES}`,
      access_token,
      body,
    });
  },
  fetchProducts: async (access_token: string, api_domain: string) => {
    return fetchBiginList(
      access_token,
      api_domain,
      `${API_ENDPOINTS.PRODUCTS}?fields=Product_Name,Owner,Product_Code,Product_Category,Unit_Price,Description,Tag,Product_Active`,
      'data'
    );
  },
  fetchTasks: async (access_token: string, api_domain: string) => {
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.TASKS}?fields=Subject,Status,Owner,Due_Date,Description,Priority,Related_To,Tags,Remind_At,Recurring_Activity,$related_module`,
      access_token,
    });
  },
  createCall: async (access_token: string, api_domain: string, body: any) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.CALLS}`,
      access_token,
      body,
    });
  },
  createEvent: async (access_token: string, api_domain: string, body: any) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.EVENTS}`,
      access_token,
      body,
    });
  },
  fetchEvents: async (access_token: string, api_domain: string) => {
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.EVENTS}?fields=Owner,Event_Title,Start_DateTime,End_DateTime,Description,Recurring_Activity,Participants,Related_To,Tag,Remind_At,$related_module,All_day,Venue`,
      access_token,
    });
  },
  updateEvent: async (access_token: string, api_domain: string, body: any) => {
    return fireHttpRequest({
      method: HttpMethod.PUT,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.EVENTS}`,
      access_token,
      body,
    });
  },
  createTask: async (access_token: string, api_domain: string, body: any) => {
    return fireHttpRequest({
      method: HttpMethod.POST,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.TASKS}`,
      access_token,
      body,
    });
  },
  updateTask: async (access_token: string, api_domain: string, body: any) => {
    return fireHttpRequest({
      method: HttpMethod.PUT,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.TASKS}`,
      access_token,
      body,
    });
  },
  fetchModules: async (access_token: string, api_domain: string) => {
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.MODULES}`,
      access_token,
    });
  },
  fetchLayouts: async (
    access_token: string,
    api_domain: string,
    module_name: string
  ) => {
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.LAYOUTS}?module=${module_name}`,
      access_token,
    });
  },
  fetchModuleFields: async (
    access_token: string,
    api_domain: string,
    module_name: string
  ) => {
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2${API_ENDPOINTS.FIELDS}?module=${module_name}`,
      access_token,
    });
  },
  searchRecords: async (
    access_token: string,
    api_domain: string,
    module_name: string,
    query: {
      key: string;
      value: string;
    }
  ) => {
    return fireHttpRequest({
      method: HttpMethod.GET,
      path: `${api_domain}/bigin/v2/${module_name}/search?${encodeURIComponent(query.key)}=${encodeURIComponent(query.value)}`,
      access_token,
    });
  }
};

