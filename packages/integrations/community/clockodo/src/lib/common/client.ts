import {
  HttpMessageBody,
  HttpMethod,
  QueryParams,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import { ListRequest, Paging, prepareListRequest } from './models/common';
import {
  User,
  UserCreateRequest,
  UserListResponse,
  UserSingleResponse,
  UserUpdateRequest,
} from './models/user';
import {
  CustomerSingleResponse,
  CustomerListResponse,
  CustomerCreateRequest,
  CustomerUpdateRequest,
  CustomerListFilter,
  Customer,
} from './models/customer';
import {
  ProjectSingleResponse,
  ProjectListResponse,
  ProjectCreateRequest,
  ProjectUpdateRequest,
  ProjectListFilter,
  Project,
} from './models/project';
import {
  Service,
  ServiceSingleResponse,
  ServiceListResponse,
  ServiceCreateRequest,
  ServiceUpdateRequest,
} from './models/service';
import {
  EntrySingleResponse,
  EntryListResponse,
  EntryCreateRequest,
  EntryUpdateRequest,
  EntryListRequest,
  Entry,
  EntryListFilter,
} from './models/entry';
import {
  AbsenceSingleResponse,
  AbsenceListResponse,
  AbsenceCreateRequest,
  AbsenceUpdateRequest,
  AbsenceListRequest,
  Absence,
} from './models/absence';
import {
  Team,
  TeamCreateRequest,
  TeamListResponse,
  TeamSingleResponse,
  TeamUpdateRequest,
} from './models/team';

/**
 * Clockodo removed its legacy API endpoints on 2026-05-01
 * (https://www.clockodo.com/en/blog/deprecation-of-legacy-api-endpoints-on-may-1-2026):
 * users/teams/customers moved to /api/v3 and projects/services/absences to /api/v4.
 * The v3/v4 resources wrap responses in a "data" envelope instead of a
 * resource-named key, so the client maps them back to the models below.
 * /api/v2/entries was not removed and keeps its original envelope.
 */
interface Envelope<T> {
  data: T;
}

interface PagedEnvelope<T> {
  paging: Paging;
  data: T[];
}

function toV4AbsenceBody(
  request: AbsenceCreateRequest | AbsenceUpdateRequest
): Record<string, unknown> {
  const { count_days, ...body } = request as Record<string, unknown>;
  // v4 dropped the numeric count_days parameter; a half day is now the boolean half_day.
  if (typeof count_days === 'number' && count_days <= 0.5) {
    body['half_day'] = true;
  }
  return body;
}

function toV4ProjectBody(
  request: ProjectCreateRequest | ProjectUpdateRequest
): Record<string, unknown> {
  const {
    budget_money,
    budget_is_hours,
    budget_is_not_strict,
    ...body
  } = request as Record<string, unknown>;
  // v4 replaced the flat budget_money/budget_is_hours/budget_is_not_strict
  // parameters with a single structured budget object.
  if (typeof budget_money === 'number') {
    body['budget'] = {
      amount: budget_money,
      monetary: !(budget_is_hours ?? false),
      hard: !(budget_is_not_strict ?? false),
    };
  }
  return body;
}

export class ClockodoClient {
  private clientIdentification: string;
  private language = 'en';

  constructor(
    private email: string,
    private token: string,
    clientName: string,
    clientEmail: string
  ) {
    this.clientIdentification = clientName + ';' + clientEmail;
  }

  setLanguage(language: string) {
    this.language = language;
  }

  async makeRequest<T extends HttpMessageBody>(
    method: HttpMethod,
    url: string,
    query?: QueryParams,
    body?: object
  ): Promise<T> {
    const res = await httpClient.sendRequest<T>({
      method,
      url: 'https://my.clockodo.com/api' + url,
      queryParams: query,
      body,
      headers: {
        'X-ClockodoApiUser': this.email,
        'X-ClockodoApiKey': this.token,
        'X-Clockodo-External-Application': this.clientIdentification,
        'Accept-Language': this.language,
      },
    });
    return res.body;
  }

  async listUsers(): Promise<UserListResponse> {
    const res = await this.makeRequest<PagedEnvelope<User>>(
      HttpMethod.GET,
      '/v3/users'
    );
    return { users: res.data };
  }

  async getUser(id: number): Promise<UserSingleResponse> {
    const res = await this.makeRequest<Envelope<User>>(
      HttpMethod.GET,
      '/v3/users/' + id
    );
    return { user: res.data };
  }

  async createUser(request: UserCreateRequest): Promise<UserSingleResponse> {
    const res = await this.makeRequest<Envelope<User>>(
      HttpMethod.POST,
      '/v3/users',
      undefined,
      request
    );
    return { user: res.data };
  }

  async updateUser(
    id: number,
    request: UserUpdateRequest
  ): Promise<UserSingleResponse> {
    const res = await this.makeRequest<Envelope<User>>(
      HttpMethod.PUT,
      '/v3/users/' + id,
      undefined,
      request
    );
    return { user: res.data };
  }

  deleteUser(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v3/users/' + id);
  }

  async listTeams(): Promise<TeamListResponse> {
    const res = await this.makeRequest<PagedEnvelope<Team>>(
      HttpMethod.GET,
      '/v3/teams'
    );
    return { teams: res.data };
  }

  async getTeam(id: number): Promise<TeamSingleResponse> {
    const res = await this.makeRequest<Envelope<Team>>(
      HttpMethod.GET,
      '/v3/teams/' + id
    );
    return { team: res.data };
  }

  async createTeam(request: TeamCreateRequest): Promise<TeamSingleResponse> {
    const res = await this.makeRequest<Envelope<Team>>(
      HttpMethod.POST,
      '/v3/teams',
      undefined,
      request
    );
    return { team: res.data };
  }

  async updateTeam(
    id: number,
    request: TeamUpdateRequest
  ): Promise<TeamSingleResponse> {
    const res = await this.makeRequest<Envelope<Team>>(
      HttpMethod.PUT,
      '/v3/teams/' + id,
      undefined,
      request
    );
    return { team: res.data };
  }

  deleteTeam(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v3/teams/' + id);
  }

  async listCustomers(
    request: ListRequest<CustomerListFilter> = {}
  ): Promise<CustomerListResponse> {
    const res = await this.makeRequest<PagedEnvelope<Customer>>(
      HttpMethod.GET,
      '/v3/customers',
      prepareListRequest(request)
    );
    return { paging: res.paging, customers: res.data };
  }

  async listAllCustomers(filter: CustomerListFilter = {}): Promise<Customer[]> {
    let totalPages = 999999;
    const all: Customer[] = [];
    for (let page = 0; page < totalPages; page++) {
      const res = await this.listCustomers({
        page: page + 1,
        filter,
      });
      totalPages = res.paging.count_pages;
      res.customers.forEach((e) => all.push(e));
    }
    return all;
  }

  async getCustomer(id: number): Promise<CustomerSingleResponse> {
    const res = await this.makeRequest<Envelope<Customer>>(
      HttpMethod.GET,
      '/v3/customers/' + id
    );
    return { customer: res.data };
  }

  async createCustomer(
    request: CustomerCreateRequest
  ): Promise<CustomerSingleResponse> {
    const res = await this.makeRequest<Envelope<Customer>>(
      HttpMethod.POST,
      '/v3/customers',
      undefined,
      request
    );
    return { customer: res.data };
  }

  async updateCustomer(
    id: number,
    request: CustomerUpdateRequest
  ): Promise<CustomerSingleResponse> {
    const res = await this.makeRequest<Envelope<Customer>>(
      HttpMethod.PUT,
      '/v3/customers/' + id,
      undefined,
      request
    );
    return { customer: res.data };
  }

  deleteCustomer(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v3/customers/' + id);
  }

  async listProjects(
    request: ListRequest<ProjectListFilter> = {}
  ): Promise<ProjectListResponse> {
    const res = await this.makeRequest<PagedEnvelope<Project>>(
      HttpMethod.GET,
      '/v4/projects',
      prepareListRequest(request)
    );
    return { paging: res.paging, projects: res.data };
  }

  async listAllProjects(filter: ProjectListFilter = {}): Promise<Project[]> {
    let totalPages = 999999;
    const all: Project[] = [];
    for (let page = 0; page < totalPages; page++) {
      const res = await this.listProjects({
        page: page + 1,
        filter,
      });
      totalPages = res.paging.count_pages;
      res.projects.forEach((e) => all.push(e));
    }
    return all;
  }

  async getProject(id: number): Promise<ProjectSingleResponse> {
    const res = await this.makeRequest<Envelope<Project>>(
      HttpMethod.GET,
      '/v4/projects/' + id
    );
    return { project: res.data };
  }

  async createProject(
    request: ProjectCreateRequest
  ): Promise<ProjectSingleResponse> {
    const res = await this.makeRequest<Envelope<Project>>(
      HttpMethod.POST,
      '/v4/projects',
      undefined,
      toV4ProjectBody(request)
    );
    return { project: res.data };
  }

  async updateProject(
    id: number,
    request: ProjectUpdateRequest
  ): Promise<ProjectSingleResponse> {
    const { completed, billed_money, billed_completely, ...rest } =
      request as Record<string, unknown>;
    const res = await this.makeRequest<Envelope<Project>>(
      HttpMethod.PUT,
      '/v4/projects/' + id,
      undefined,
      toV4ProjectBody(rest as ProjectUpdateRequest)
    );
    let project = res.data;
    // v4 moved billed state and completion off the plain update
    // into the dedicated setBilled/complete endpoints.
    if (billed_money !== undefined || billed_completely !== undefined) {
      const billedRes = await this.makeRequest<Envelope<Project>>(
        HttpMethod.PUT,
        '/v3/projects/' + id + '/setBilled',
        undefined,
        {
          ...(billed_money !== undefined ? { billed_money } : {}),
          ...(billed_completely !== undefined ? { billed: billed_completely } : {}),
        }
      );
      project = billedRes.data;
    }
    if (completed !== undefined) {
      const completedRes = await this.makeRequest<Envelope<Project>>(
        HttpMethod.PUT,
        '/v4/projects/' + id + '/complete',
        undefined,
        { completed }
      );
      project = completedRes.data;
    }
    return { project };
  }

  deleteProject(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v4/projects/' + id);
  }

  async listServices(): Promise<ServiceListResponse> {
    const res = await this.makeRequest<PagedEnvelope<Service>>(
      HttpMethod.GET,
      '/v4/services'
    );
    return { services: res.data };
  }

  async getService(id: number): Promise<ServiceSingleResponse> {
    const res = await this.makeRequest<Envelope<Service>>(
      HttpMethod.GET,
      '/v4/services/' + id
    );
    return { service: res.data };
  }

  async createService(
    request: ServiceCreateRequest
  ): Promise<ServiceSingleResponse> {
    const res = await this.makeRequest<Envelope<Service>>(
      HttpMethod.POST,
      '/v4/services',
      undefined,
      request
    );
    return { service: res.data };
  }

  async updateService(
    id: number,
    request: ServiceUpdateRequest
  ): Promise<ServiceSingleResponse> {
    const res = await this.makeRequest<Envelope<Service>>(
      HttpMethod.PUT,
      '/v4/services/' + id,
      undefined,
      request
    );
    return { service: res.data };
  }

  deleteService(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v4/services/' + id);
  }

  listEntries(request: EntryListRequest): Promise<EntryListResponse> {
    return this.makeRequest<EntryListResponse>(
      HttpMethod.GET,
      '/v2/entries',
      prepareListRequest(request)
    );
  }

  async listAllEntries(
    time_since: string,
    time_until: string,
    filter: EntryListFilter = {}
  ): Promise<Entry[]> {
    let totalPages = 999999;
    const all: Entry[] = [];
    for (let page = 0; page < totalPages; page++) {
      const res = await this.listEntries({
        page: page + 1,
        time_since,
        time_until,
        filter,
      });
      totalPages = res.paging.count_pages;
      res.entries.forEach((e) => all.push(e));
    }
    return all;
  }

  getEntry(id: number): Promise<EntrySingleResponse> {
    return this.makeRequest<EntrySingleResponse>(
      HttpMethod.GET,
      '/v2/entries/' + id
    );
  }

  createEntry(request: EntryCreateRequest): Promise<EntrySingleResponse> {
    return this.makeRequest<EntrySingleResponse>(
      HttpMethod.POST,
      '/v2/entries',
      undefined,
      request
    );
  }

  updateEntry(
    id: number,
    request: EntryUpdateRequest
  ): Promise<EntrySingleResponse> {
    return this.makeRequest<EntrySingleResponse>(
      HttpMethod.PUT,
      '/v2/entries/' + id,
      undefined,
      request
    );
  }

  deleteEntry(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v2/entries/' + id);
  }

  async listAbsences(request: AbsenceListRequest): Promise<AbsenceListResponse> {
    const query: QueryParams = {
      'filter[year]': request.year.toString(),
    };
    if (request.users_id) query['filter[users_id]'] = request.users_id.toString();
    const res = await this.makeRequest<Envelope<Absence[]>>(
      HttpMethod.GET,
      '/v4/absences',
      query
    );
    return { absences: res.data };
  }

  async getAbsence(id: number): Promise<AbsenceSingleResponse> {
    const res = await this.makeRequest<Envelope<Absence>>(
      HttpMethod.GET,
      '/v4/absences/' + id
    );
    return { absence: res.data };
  }

  async createAbsence(
    request: AbsenceCreateRequest
  ): Promise<AbsenceSingleResponse> {
    const res = await this.makeRequest<Envelope<Absence>>(
      HttpMethod.POST,
      '/v4/absences',
      undefined,
      toV4AbsenceBody(request)
    );
    return { absence: res.data };
  }

  async updateAbsence(
    id: number,
    request: AbsenceUpdateRequest
  ): Promise<AbsenceSingleResponse> {
    const res = await this.makeRequest<Envelope<Absence>>(
      HttpMethod.PUT,
      '/v4/absences/' + id,
      undefined,
      toV4AbsenceBody(request)
    );
    return { absence: res.data };
  }

  deleteAbsence(id: number): Promise<object> {
    return this.makeRequest<object>(HttpMethod.DELETE, '/v4/absences/' + id);
  }
}
