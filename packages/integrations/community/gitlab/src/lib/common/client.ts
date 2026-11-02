import {
  AuthenticationType,
  HttpMessageBody,
  HttpMethod,
  QueryParams,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import {
  ListProjectsRequest,
  CreateProjectIssueRequest,
  GitlabProject,
  ProjectWebhookRequest,
  ProjectWebhook,
} from './models';
export class GitlabApi {
  constructor(private accessToken: string) {}

  async makeRequest<T extends HttpMessageBody>(
    method: HttpMethod,
    url: string,
    query?: QueryParams,
    body?: object
  ): Promise<T> {
    const res = await httpClient.sendRequest<T>({
      method,
      url: 'https://gitlab.com/api/v4' + url,
      queryParams: query,
      body,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: this.accessToken,
      },
    });
    return res.body;
  }
  async listProjects(request: ListProjectsRequest) {
    return this.makeRequest<GitlabProject[]>(
      HttpMethod.GET,
      '/projects',
      prepareQuery(request)
    );
  }

  // GitLab lists return 20 items per page by default (per_page max 100)
  // and paginate via the `page` parameter
  // https://docs.gitlab.com/api/rest/#pagination
  async listAllProjects(
    request: ListProjectsRequest,
    maxPages = 50
  ): Promise<{ projects: GitlabProject[]; truncated: boolean }> {
    const projects: GitlabProject[] = [];
    let truncated = false;
    const perPage = 100;
    let page = 1;
    let lastPageSize = perPage;

    while (page <= maxPages && lastPageSize === perPage) {
      const batch = await this.makeRequest<GitlabProject[]>(
        HttpMethod.GET,
        '/projects',
        prepareQuery({ ...request, per_page: perPage, page })
      );
      lastPageSize = Array.isArray(batch) ? batch.length : 0;
      if (Array.isArray(batch)) {
        projects.push(...batch);
      }
      if (page >= maxPages && lastPageSize === perPage) {
        truncated = true;
      }
      page++;
    }

    return { projects, truncated };
  }
  async createProjectIssue(
    projectId: string,
    request: CreateProjectIssueRequest
  ) {
    return this.makeRequest(
      HttpMethod.POST,
      `/projects/${projectId}/issues`,
      undefined,
      request
    );
  }
  async subscribeProjectWebhook(
    projectId: string,
    request: ProjectWebhookRequest
  ) {
    return this.makeRequest<ProjectWebhook>(
      HttpMethod.POST,
      `/projects/${projectId}/hooks`,
      undefined,
      request
    );
  }
  async unsubscribeProjectWebhook(projectId: string, webhookId: string) {
    return this.makeRequest(
      HttpMethod.DELETE,
      `/projects/${projectId}/hooks/${webhookId}`,
      undefined
    );
  }
}

function emptyValueFilter(
  accessor: (key: string) => any
): (key: string) => boolean {
  return (key: string) => {
    const val = accessor(key);
    return (
      val !== null &&
      val !== undefined &&
      (typeof val != 'string' || val.length > 0)
    );
  };
}

export function prepareQuery(request?: Record<string, any>): QueryParams {
  const params: QueryParams = {};
  if (!request) return params;
  Object.keys(request)
    .filter(emptyValueFilter((k) => request[k]))
    .forEach((k: string) => {
      params[k] = (request as Record<string, any>)[k].toString();
    });
  return params;
}

