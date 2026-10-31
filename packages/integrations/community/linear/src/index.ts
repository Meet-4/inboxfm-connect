import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { linearCreateComment } from './lib/actions/comments/create-comment';
import { linearCreateIssue } from './lib/actions/issues/create-issue';
import { linearUpdateIssue } from './lib/actions/issues/update-issue';
import { linearCreateProject } from './lib/actions/projects/create-project';
import { linearUpdateProject } from './lib/actions/projects/update-project';
import { linearRawGraphqlQuery } from './lib/actions/raw-graphql-query';
import { linearNewComment } from './lib/triggers/new-comment';
import { linearNewIssue } from './lib/triggers/new-issue';
import { linearUpdatedIssue } from './lib/triggers/updated-issue';
import { linearRemovedIssue } from './lib/triggers/removed-issue';
import { linearNewProject } from './lib/triggers/new-project';
import { linearUpdatedProject } from './lib/triggers/updated-project';
import { linearRemovedProject } from './lib/triggers/removed-project';

const markdown = `
To obtain your API key, follow these steps:

1. Go to settings by clicking your profile-pic (top-left)
2. Go to Security & Access section
3. On Personal API keys, give label and press create key.`;

export const linearAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  required: true,
  description: markdown,
  validate: async ({ auth }) => {
    try {
      // The GraphQL API answers 401 (AUTHENTICATION_ERROR) for an invalid
      // key. Linear expects the raw key in the Authorization header, and
      // the host is api.linear.app — api.linear.com no longer resolves.
      await httpClient.sendRequest({
        method: HttpMethod.POST,
        url: 'https://api.linear.app/graphql',
        headers: {
          'Content-Type': 'application/json',
          Authorization: auth,
        },
        body: { query: '{ viewer { id } }' },
      });
      return {
        valid: true,
      };
    } catch {
      return {
        valid: false,
        error: 'Invalid API Key',
      };
    }
  },
});
export const linear = createPiece({
  displayName: 'Linear',
  description: 'Issue tracking for modern software teams',

  auth: linearAuth,
  minimumSupportedRelease: '0.30.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/linear.png',
  authors: ['lldiegon', 'kishanprmr', 'abuaboud'],
  categories: [PieceCategory.PRODUCTIVITY],
  actions: [
    linearCreateIssue,
    linearUpdateIssue,
    linearCreateProject,
    linearUpdateProject,
    linearCreateComment,
    linearRawGraphqlQuery,
  ],
  triggers: [
    linearNewComment,
    linearNewIssue,
    linearUpdatedIssue,
    linearRemovedIssue,
    linearNewProject,
    linearUpdatedProject,
    linearRemovedProject,
  ],
});

