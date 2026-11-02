import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';
import { API_ENDPOINTS, BASE_URL, CopperAuthType } from './constants';

async function fireHttpRequest({
  method,
  path,
  auth,
  body,
}: {
  method: HttpMethod;
  path: string;
  auth: CopperAuthType;
  body?: any;
}) {
  return await httpClient
    .sendRequest({
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-PW-AccessToken': auth.props.apiKey,
        'X-PW-Application': 'developer_api',
        'X-PW-UserEmail': auth.props.email,
      },
      body,
    })
    .then((res) => res.body)
    .catch((err) => {
      throw err;
    });
}


// Copper's /search endpoints default to page_size=20 (1-200 allowed) and
// page with page_number; a response shorter than the page size is the last
// page. The record dropdowns sent no payload, so every picker silently
// showed only the first 20 records. Walk pages at the documented maximum
// page size with a bounded budget and report truncation.
// https://developer.copper.com/introduction/pagination.html
const COPPER_SEARCH_PAGE_SIZE = 200;
const COPPER_SEARCH_MAX_PAGES = 10;

async function searchCopperPaged(
  auth: CopperAuthType,
  path: string,
  payload?: any
): Promise<{ items: any[]; truncated: boolean }> {
  const items: any[] = [];
  let truncated = false;

  for (let pageNumber = 1; pageNumber <= COPPER_SEARCH_MAX_PAGES; pageNumber++) {
    const body = {
      ...(payload ?? {}),
      page_size: COPPER_SEARCH_PAGE_SIZE,
      page_number: pageNumber,
    };
    const response = await fireHttpRequest({
      method: HttpMethod.POST,
      path,
      auth,
      body,
    });
    const page: any[] = Array.isArray(response) ? response : [];
    items.push(...page);

    if (page.length < COPPER_SEARCH_PAGE_SIZE) {
      break;
    }
    if (pageNumber === COPPER_SEARCH_MAX_PAGES) {
      truncated = true;
    }
  }

  return { items, truncated };
}

export const CopperApiService = {
  async fetchCurrentUser(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1${API_ENDPOINTS.USERS}/me`,
      auth,
    });
  },
  async fetchLeads(auth: CopperAuthType, payload?: any) {
    const { items } = await searchCopperPaged(
      auth,
      `/v1${API_ENDPOINTS.LEADS}/search`,
      payload
    );
    return items;
  },
  async fetchLeadsPaged(auth: CopperAuthType, payload?: any) {
    return searchCopperPaged(auth, `/v1{API_ENDPOINTS.LEADS}/search`, payload);
  },
  async createTask(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.TASKS}`,
      auth,
      body: payload,
    });
  },
  async createProject(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.PROJECTS}`,
      auth,
      body: payload,
    });
  },
  async updateProject(auth: CopperAuthType, projectId: string, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.PUT,
      path: `/v1${API_ENDPOINTS.PROJECTS}/${projectId}`,
      auth,
      body: payload,
    });
  },
  async fetchProjects(auth: CopperAuthType, payload?: any) {
    const { items } = await searchCopperPaged(
      auth,
      `/v1${API_ENDPOINTS.PROJECTS}/search`,
      payload
    );
    return items;
  },
  async fetchProjectsPaged(auth: CopperAuthType, payload?: any) {
    return searchCopperPaged(auth, `/v1${API_ENDPOINTS.PROJECTS}/search`, payload);
  },
  async createCompany(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.COMPANIES}`,
      auth,
      body: payload,
    });
  },
  async updateCompany(auth: CopperAuthType, companyId: string, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.PUT,
      path: `/v1${API_ENDPOINTS.COMPANIES}/${companyId}`,
      auth,
      body: payload,
    });
  },
  async fetchCompanies(auth: CopperAuthType, payload?: any) {
    const { items } = await searchCopperPaged(
      auth,
      `/v1${API_ENDPOINTS.COMPANIES}/search`,
      payload
    );
    return items;
  },
  async fetchCompaniesPaged(auth: CopperAuthType, payload?: any) {
    return searchCopperPaged(auth, `/v1{API_ENDPOINTS.COMPANIES}/search`, payload);
  },
  async fetchActivityTypes(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1/activity_types`,
      auth,
    });
  },
  async fetchContactTypes(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1/contact_types`,
      auth,
    });
  },
  async fetchLeadStatuses(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1/lead_statuses`,
      auth,
    });
  },
  async fetchCustomerSources(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1/customer_sources`,
      auth,
    });
  },
  async fetchLossReasons(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1/loss_reasons`,
      auth,
    });
  },
  async createActivity(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1/activities`,
      auth,
      body: payload,
    });
  },
  async fetchActivities(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1/activities/search`,
      auth,
      body: payload,
    });
  },
  async createOpportunity(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.OPPORTUNITIES}`,
      auth,
      body: payload,
    });
  },
  async updateOpportunity(
    auth: CopperAuthType,
    opportunityId: string,
    payload: any
  ) {
    return await fireHttpRequest({
      method: HttpMethod.PUT,
      path: `/v1${API_ENDPOINTS.OPPORTUNITIES}/${opportunityId}`,
      auth,
      body: payload,
    });
  },
  async fetchOpportunities(auth: CopperAuthType, payload?: any) {
    const { items } = await searchCopperPaged(
      auth,
      `/v1${API_ENDPOINTS.OPPORTUNITIES}/search`,
      payload
    );
    return items;
  },
  async fetchOpportunitiesPaged(auth: CopperAuthType, payload?: any) {
    return searchCopperPaged(auth, `/v1{API_ENDPOINTS.OPPORTUNITIES}/search`, payload);
  },
  async fetchTasks(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.TASKS}/search`,
      auth,
    });
  },
  async fetchPipelines(auth: CopperAuthType) {
    return await fireHttpRequest({
      method: HttpMethod.GET,
      path: `/v1${API_ENDPOINTS.PIPELINES}`,
      auth,
    });
  },
  async createLead(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.LEADS}`,
      auth,
      body: payload,
    });
  },
  async updateLead(auth: CopperAuthType, leadId: string, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.PUT,
      path: `/v1${API_ENDPOINTS.LEADS}/${leadId}`,
      auth,
      body: payload,
    });
  },
  async convertLead(auth: CopperAuthType, leadId: string, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.LEADS}/${leadId}/convert`,
      auth,
      body: payload,
    });
  },
  async createPerson(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.PEOPLE}`,
      auth,
      body: payload,
    });
  },
  async updatePerson(auth: CopperAuthType, personId: string, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.PUT,
      path: `/v1${API_ENDPOINTS.PEOPLE}/${personId}`,
      auth,
      body: payload,
    });
  },
  async fetchPeople(auth: CopperAuthType, payload?: any) {
    const { items } = await searchCopperPaged(
      auth,
      `/v1${API_ENDPOINTS.PEOPLE}/search`,
      payload
    );
    return items;
  },
  async fetchPeoplePaged(auth: CopperAuthType, payload?: any) {
    return searchCopperPaged(auth, `/v1{API_ENDPOINTS.PEOPLE}/search`, payload);
  },
  async fetchUsers(auth: CopperAuthType) {
    const { items } = await searchCopperPaged(
      auth,
      `/v1${API_ENDPOINTS.USERS}/search`
    );
    return items;
  },
  async fetchUsersPaged(auth: CopperAuthType) {
    return searchCopperPaged(auth, `/v1${API_ENDPOINTS.USERS}/search`);
  },
  async createWebhook(auth: CopperAuthType, payload: any) {
    return await fireHttpRequest({
      method: HttpMethod.POST,
      path: `/v1${API_ENDPOINTS.WEBHOOKS}`,
      auth,
      body: payload,
    });
  },
  async deleteWebhook(auth: CopperAuthType, webhookId: string) {
    return await fireHttpRequest({
      method: HttpMethod.DELETE,
      path: `/v1${API_ENDPOINTS.WEBHOOKS}/${webhookId}`,
      auth,
    });
  },
};

