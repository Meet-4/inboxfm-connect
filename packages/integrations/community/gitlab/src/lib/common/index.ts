import { getAccessTokenOrThrow } from '@inboxfm-connect/pieces-common';
import { OAuth2PropertyValue, Property } from '@inboxfm-connect/pieces-framework';
import { GitlabApi } from './client';
import { GitlabProject } from './models';
import { gitlabAuth } from '../auth';

export const gitlabCommon = {
  projectId: (required = true) =>
    Property.Dropdown({
      auth: gitlabAuth,
      displayName: 'Project',
      required,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Setup authentication first',
            options: [],
          };
        }
        const client = makeClient({
          auth: auth,
        });
        // GitLab returns 20 results per page by default (per_page max is 100);
        // follow pages until a short page so the dropdown lists every project.
        // https://docs.gitlab.com/ee/api/rest/#offset-based-pagination
        const perPage = 100;
        const projects: GitlabProject[] = [];
        let page = 1;
        for (;;) {
          const res = await client.listProjects({
            simple: true,
            membership: true,
            page,
            per_page: perPage,
          });
          projects.push(...res);
          if (res.length < perPage) {
            break;
          }
          page++;
        }
        return {
          disabled: false,
          options: projects.map((project) => {
            return {
              label: project.name,
              value: project.id,
            };
          }),
        };
      },
    }),
};

export function makeClient(propsValue: {
  auth: OAuth2PropertyValue;
}): GitlabApi {
  const token = getAccessTokenOrThrow(propsValue.auth);
  return new GitlabApi(token);
}

