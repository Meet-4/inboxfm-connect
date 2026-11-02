import {
  AuthenticationType,
  httpClient,
  HttpMethod,
  HttpRequest,
} from '@inboxfm-connect/pieces-common';
import {
  CreateOpportunityParams,
  CreatePartyParams,
  CreateProjectParams,
  Milestone,
  Opportunity,
  Party,
  Project,
  UpdateOpportunityParams,
  UpdatePartyParams,
  Case,
  CreateTaskParams,
  Task,
  User,
  Team,
  Tag,
  CustomField,
  CreateNoteParams,
  Note,
  FindProjectParams,
  FindOpportunityParams,
  Webhook,
  Stage,
  Category,
  ActivityType,
  CreateEntryParams,
  Entry,
  Filter,
  CreateRestHookParams,
  RestHook,
} from './types';
import { CapsuleCrmAuthType } from './auth';


// Capsule paginates every multi-item response (50 per page by default,
// up to 100 with perPage) via the `page` query parameter.
// https://developer.capsulecrm.com/v2/overview/reading-from-the-api
const CAPSULE_PAGE_SIZE = 100;
const CAPSULE_MAX_PAGES = 10;

async function fetchCapsulePaged<T>(
  url: string,
  listKey: string,
  auth: CapsuleCrmAuthType,
  extraQuery: Record<string, string> = {}
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];

  for (let page = 1; page <= CAPSULE_MAX_PAGES; page++) {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      queryParams: {
        ...extraQuery,
        page: String(page),
        perPage: String(CAPSULE_PAGE_SIZE),
      },
    };
    const response = await httpClient.sendRequest<Record<string, T[]>>(request);
    const batch = response.body?.[listKey] ?? [];
    items.push(...batch);
    if (batch.length < CAPSULE_PAGE_SIZE) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}


// Maps a paged Capsule response into dropdown options and appends the
// standard truncation notice when the page budget was exhausted.
export function capsuleOptions<TItem, TValue>(
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

export const capsuleCrmClient = {
  async createContact(
    auth: CapsuleCrmAuthType,
    params: CreatePartyParams
  ): Promise<Party> {
    const partyData: { [key: string]: unknown } = {
      type: params.type,
    };

    if (params.type === 'person') {
      partyData['firstName'] = params.firstName;
      partyData['lastName'] = params.lastName;
    } else {
      partyData['name'] = params.name;
    }

    if (params.title) partyData['title'] = params.title;
    if (params.jobTitle) partyData['jobTitle'] = params.jobTitle;
    if (params.about) partyData['about'] = params.about;

    if (params.organisationId) {
      partyData['organisation'] = { id: params.organisationId };
    }

    if (params.ownerId) {
      partyData['owner'] = { id: params.ownerId };
    }
    if (params.teamId) {
      partyData['team'] = { id: params.teamId };
    }
    if (params.tags) {
      partyData['tags'] = params.tags.map((tag) => ({ name: tag }));
    }
    if (params.fields) {
      partyData['fields'] = params.fields;
    }

    if (params.emailAddresses) {
      partyData['emailAddresses'] = params.emailAddresses;
    }
    if (params.phoneNumbers) {
      partyData['phoneNumbers'] = params.phoneNumbers;
    }
    if (params.addresses) {
      partyData['addresses'] = params.addresses;
    }
    if (params.websites) {
      partyData['websites'] = params.websites;
    }

    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: 'https://api.capsulecrm.com/api/v2/parties',
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        party: partyData,
      },
    };

    const response = await httpClient.sendRequest<Party>(request);
    return response.body;
  },

  async searchContacts(
    auth: CapsuleCrmAuthType,
    searchTerm: string
  ): Promise<{ items: Party[]; truncated: boolean }> {
    const isSearch = searchTerm && searchTerm.length > 0;
    return fetchCapsulePaged<Party>(
      isSearch
        ? 'https://api.capsulecrm.com/api/v2/parties/search'
        : 'https://api.capsulecrm.com/api/v2/parties',
      'parties',
      auth,
      isSearch ? { q: searchTerm } : {}
    );
  },

  async searchOrganisations(
    auth: CapsuleCrmAuthType,
    searchTerm?: string
  ): Promise<Party[]> {
    try {
      const url = searchTerm
        ? `https://api.capsulecrm.com/api/v2/parties/search`
        : `https://api.capsulecrm.com/api/v2/parties`;

      const queryParams: Record<string, string> = {
        perPage: '100',
      };

      if (searchTerm) {
        queryParams['q'] = searchTerm;
      }

      const request: HttpRequest = {
        method: HttpMethod.GET,
        url: url,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.access_token,
        },
        queryParams: queryParams,
      };
      
      const response = await httpClient.sendRequest<{ parties: Party[] }>(
        request
      );
      
      if (!response.body || !response.body.parties) {
        return [];
      }
      
      // Capsule returns people and organisations mixed in `parties`; the
      // organisations dropdown only wants the organisation records.
      const organisations = response.body.parties.filter(
        (party) => party.type === 'organisation'
      );
      return organisations;
    } catch {
      // Leave the dropdown empty when the lookup fails so the rest of the
      // form stays usable (reconnect or check the API token).
      return [];
    }
  },

  async listTeams(auth: CapsuleCrmAuthType): Promise<{ items: Team[]; truncated: boolean }> {
    return fetchCapsulePaged<Team>(`https://api.capsulecrm.com/api/v2/teams`, 'teams', auth);
  },

  async listTags(auth: CapsuleCrmAuthType): Promise<{ items: Tag[]; truncated: boolean }> {
    return fetchCapsulePaged<Tag>(`https://api.capsulecrm.com/api/v2/parties/tags`, 'tags', auth);
  },

  async listCustomFields(
    auth: CapsuleCrmAuthType
  ): Promise<{ items: CustomField[]; truncated: boolean }> {
    return fetchCapsulePaged<CustomField>(
      'https://api.capsulecrm.com/api/v2/parties/fields/definitions',
      'definitions',
      auth
    );
  },

  async updateContact(
    auth: CapsuleCrmAuthType,
    partyId: number,
    params: UpdatePartyParams
  ): Promise<Party> {
    const partyData: { [key: string]: unknown } = {};
    if (params.firstName) partyData['firstName'] = params.firstName;
    if (params.lastName) partyData['lastName'] = params.lastName;
    if (params.name) partyData['name'] = params.name;
    if (params.title) partyData['title'] = params.title;
    if (params.about) partyData['about'] = params.about;
    if (params.ownerId) partyData['owner'] = { id: params.ownerId };
    if (params.teamId) partyData['team'] = { id: params.teamId };
    if (params.addresses) partyData['addresses'] = params.addresses;
    if (params.websites) partyData['websites'] = params.websites;
    if (params.emailAddresses)
      partyData['emailAddresses'] = params.emailAddresses;
    if (params.phoneNumbers) partyData['phoneNumbers'] = params.phoneNumbers;

    const request: HttpRequest = {
      method: HttpMethod.PUT,
      url: `https://api.capsulecrm.com/api/v2/parties/${partyId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        party: partyData,
      },
    };
    const response = await httpClient.sendRequest<Party>(request);
    return response.body;
  },

  async listMilestones(auth: CapsuleCrmAuthType): Promise<{ items: Milestone[]; truncated: boolean }> {
    return fetchCapsulePaged<Milestone>(`https://api.capsulecrm.com/api/v2/milestones`, 'milestones', auth);
  },

  async searchOpportunities(auth: CapsuleCrmAuthType): Promise<{ items: Opportunity[]; truncated: boolean }> {
    return fetchCapsulePaged<Opportunity>(`https://api.capsulecrm.com/api/v2/opportunities`, 'opportunities', auth);
  },

  async getOpportunity(
    auth: CapsuleCrmAuthType,
    opportunityId: number
  ): Promise<Opportunity> {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url: `https://api.capsulecrm.com/api/v2/opportunities/${opportunityId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      queryParams: {
        embed: 'tags,fields',
      },
    };
    const response = await httpClient.sendRequest<{ opportunity: Opportunity }>(
      request
    );
    return response.body.opportunity;
  },

  async createOpportunity(
    auth: CapsuleCrmAuthType,
    params: CreateOpportunityParams
  ): Promise<Opportunity> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/opportunities`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        opportunity: params,
      },
    };
    const response = await httpClient.sendRequest<{ opportunity: Opportunity }>(
      request
    );
    return response.body.opportunity;
  },

  async listOpportunities(auth: CapsuleCrmAuthType): Promise<{ items: Opportunity[]; truncated: boolean }> {
    return fetchCapsulePaged<Opportunity>(`https://api.capsulecrm.com/api/v2/opportunities`, 'opportunities', auth);
  },

  async updateOpportunity(
    auth: CapsuleCrmAuthType,
    opportunityId: number,
    params: UpdateOpportunityParams
  ): Promise<Opportunity> {
    const request: HttpRequest = {
      method: HttpMethod.PUT,
      url: `https://api.capsulecrm.com/api/v2/opportunities/${opportunityId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        opportunity: params,
      },
    };
    const response = await httpClient.sendRequest<{ opportunity: Opportunity }>(
      request
    );
    return response.body.opportunity;
  },

  async listCategories(auth: CapsuleCrmAuthType): Promise<Category[]> {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url: `https://api.capsulecrm.com/api/v2/categories`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
    };
    const response = await httpClient.sendRequest<{ categories: Category[] }>(
      request
    );
    return response.body.categories;
  },

  async searchProjects(auth: CapsuleCrmAuthType): Promise<Project[]> {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url: `https://api.capsulecrm.com/api/v2/kases`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
    };
    const response = await httpClient.sendRequest<{ kases: Project[] }>(request);
    return response.body.kases;
  },

  async subscribeRestHook(
    auth: CapsuleCrmAuthType,
    params: CreateRestHookParams
  ): Promise<RestHook> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/resthooks`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        restHook: params,
      },
    };
    const response = await httpClient.sendRequest<{ restHook: RestHook }>(
      request
    );
    return response.body.restHook;
  },

  async unsubscribeRestHook(
    auth: CapsuleCrmAuthType,
    hookId: number
  ): Promise<void> {
    const request: HttpRequest = {
      method: HttpMethod.DELETE,
      url: `https://api.capsulecrm.com/api/v2/resthooks/${hookId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
    };
    await httpClient.sendRequest(request);
  },

  async listActivityTypes(auth: CapsuleCrmAuthType): Promise<{ items: ActivityType[]; truncated: boolean }> {
    return fetchCapsulePaged<ActivityType>(`https://api.capsulecrm.com/api/v2/activitytypes`, 'activityTypes', auth);
  },

  async findContact(
    auth: CapsuleCrmAuthType,
    term: string
  ): Promise<Party[]> {
    const { items } = await fetchCapsulePaged<Party>(
      'https://api.capsulecrm.com/api/v2/parties/search',
      'parties',
      auth,
      { q: term }
    );
    return items;
  },

  async filterOpportunities(
    auth: CapsuleCrmAuthType,
    filter: Filter
  ): Promise<Opportunity[]> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/opportunities/filters/results`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        filter: filter,
      },
    };
    const response = await httpClient.sendRequest<{
      opportunities: Opportunity[];
    }>(request);
    return response.body.opportunities;
  },

  async filterProjects(
    auth: CapsuleCrmAuthType,
    filter: Filter
  ): Promise<Project[]> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/kases/filters/results`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        filter: filter,
      },
    };
    const response = await httpClient.sendRequest<{ kases: Project[] }>(
      request
    );
    return response.body.kases;
  },

  async listStages(auth: CapsuleCrmAuthType): Promise<{ items: Stage[]; truncated: boolean }> {
    return fetchCapsulePaged<Stage>(`https://api.capsulecrm.com/api/v2/stages`, 'stages', auth);
  },

  async createProject(
    auth: CapsuleCrmAuthType,
    params: CreateProjectParams
  ): Promise<Project> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/kases`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        kase: params,
      },
    };
    const response = await httpClient.sendRequest<{ kase: Project }>(request);
    return response.body.kase;
  },

  async listProjects(auth: CapsuleCrmAuthType): Promise<{ items: Project[]; truncated: boolean }> {
    return fetchCapsulePaged<Project>(`https://api.capsulecrm.com/api/v2/kases`, 'kases', auth);
  },

  async listCases(auth: CapsuleCrmAuthType): Promise<{ items: Case[]; truncated: boolean }> {
    return fetchCapsulePaged<Case>(`https://api.capsulecrm.com/api/v2/kases`, 'kases', auth);
  },

  async listUsers(auth: CapsuleCrmAuthType): Promise<{ items: User[]; truncated: boolean }> {
    return fetchCapsulePaged<User>(`https://api.capsulecrm.com/api/v2/users`, 'users', auth);
  },

  async createEntry(
    auth: CapsuleCrmAuthType,
    params: CreateEntryParams
  ): Promise<Entry> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/entries`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        entry: params,
      },
    };
    const response = await httpClient.sendRequest<{ entry: Entry }>(request);
    return response.body.entry;
  },

  async createTask(
    auth: CapsuleCrmAuthType,
    params: CreateTaskParams
  ): Promise<Task> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/tasks`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        task: params,
      },
    };
    const response = await httpClient.sendRequest<{ task: Task }>(request);
    return response.body.task;
  },

  async createNote(
    auth: CapsuleCrmAuthType,
    params: CreateNoteParams
  ): Promise<Note> {
    const entryData: { [key: string]: unknown } = {
      type: 'Note',
      content: params.content,
    };

    if (params.partyId) entryData['party'] = { id: params.partyId };
    if (params.opportunityId)
      entryData['opportunity'] = { id: params.opportunityId };
    if (params.caseId) entryData['case'] = { id: params.caseId };
    if (params.projectId) entryData['project'] = { id: params.projectId };

    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: 'https://api.capsulecrm.com/api/v2/entries',
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        entry: entryData,
      },
    };

    const response = await httpClient.sendRequest<Note>(request);
    return response.body;
  },

  async getContact(
    auth: CapsuleCrmAuthType,
    contactId: number
  ): Promise<Party | null> {
    try {
      const request: HttpRequest = {
        method: HttpMethod.GET,
        url: `https://api.capsulecrm.com/api/v2/parties/${contactId}`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.access_token,
        },
        queryParams: {
          embed: 'addresses,phoneNumbers,websites,emailAddresses',
        },
      };
      const response = await httpClient.sendRequest<{ party: Party }>(request);
      return response.body.party;
    } catch (e) {
      return null;
    }
  },

  async findProject(
    auth: CapsuleCrmAuthType,
    params: FindProjectParams
  ): Promise<Project[]> {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url: `https://api.capsulecrm.com/api/v2/kases`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      queryParams: {
        q: params.searchTerm,
      },
    };
    const response = await httpClient.sendRequest<{ kases: Project[] }>(
      request
    );
    return response.body.kases;
  },

  async getProject(
    auth: CapsuleCrmAuthType,
    projectId: number
  ): Promise<Project | null> {
    try {
      const request: HttpRequest = {
        method: HttpMethod.GET,
        url: `https://api.capsulecrm.com/api/v2/kases/${projectId}`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.access_token,
        },
      };
      const response = await httpClient.sendRequest<{ kase: Project }>(request);
      return response.body.kase;
    } catch (e) {
      return null;
    }
  },

  async findOpportunity(
    auth: CapsuleCrmAuthType,
    params: FindOpportunityParams
  ): Promise<Opportunity[]> {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url: `https://api.capsulecrm.com/api/v2/opportunities/search`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      queryParams: {
        q: params.searchTerm,
      },
    };
    const response = await httpClient.sendRequest<{
      opportunities: Opportunity[];
    }>(request);
    return response.body.opportunities;
  },

  async subscribeWebhook(
    auth: CapsuleCrmAuthType,
    url: string,
    event: string
  ): Promise<Webhook> {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `https://api.capsulecrm.com/api/v2/webhooks`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
      body: {
        webhook: {
          url: url,
          event: event,
        },
      },
    };
    const response = await httpClient.sendRequest<{ webhook: Webhook }>(
      request
    );
    return response.body.webhook;
  },

  async unsubscribeWebhook(
    auth: CapsuleCrmAuthType,
    webhookId: number
  ): Promise<void> {
    const request: HttpRequest = {
      method: HttpMethod.DELETE,
      url: `https://api.capsulecrm.com/api/v2/webhooks/${webhookId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: auth.access_token,
      },
    };
    await httpClient.sendRequest(request);
  },
};
