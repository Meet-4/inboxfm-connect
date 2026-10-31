import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { githubAuth } from '../auth';
import {
  generateWebhookSecret,
  githubApiCall,
  githubCommon,
  verifyGithubWebhookSignature,
} from '../common';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

interface WebhookInformation {
  webhookId: number;
  webhookSecret?: string;
  repo: string;
  owner: string;
}

interface PushCommit {
  distinct?: boolean;
}

interface PushPayload {
  deleted?: boolean;
  ref?: string;
  commits?: PushCommit[];
}

export const newCommitTrigger = createTrigger({
  auth: githubAuth,
  name: 'new_commit',
  displayName: 'New Commit',
  description: 'Triggers when a new commit is pushed.',
  aiMetadata: {
    description:
      'Fires when commits are pushed to a branch of the chosen repository (push events to refs/heads/*; branch deletions are ignored), emitting one item per distinct new commit. Represents new commits landing on a branch.',
  },
  props: {
    repository: githubCommon.repositoryDropdown,
  },

  sampleData: {
    ref: 'refs/heads/main',
    commits: [
      {
        id: 'def456',
        message: 'Add new feature',
        timestamp: '2026-02-15T12:34:56Z',
        url: 'https://github.com/activepieces/activepieces/commit/def456',
      },
    ],
    repository: {
      full_name: 'activepieces/activepieces',
    },
    sender: {
      login: 'Logan',
    },
  },

  type: TriggerStrategy.WEBHOOK,

  async onEnable(context) {
    const { repo, owner } = context.propsValue.repository!;
    const webhookSecret = generateWebhookSecret();

    const response = await githubApiCall<{ id: number }>({
      auth: context.auth,
      method: HttpMethod.POST,
      resourceUri: `/repos/${owner}/${repo}/hooks`,
      body: {
        name: 'web',
        active: true,
        events: ['push'],
        config: {
          url: context.webhookUrl,
          content_type: 'json',
          insecure_ssl: '0',
          secret: webhookSecret,
        },
      },
    });

    await context.store.put<WebhookInformation>('github_new_commit_trigger', {
      webhookId: response.body.id,
      webhookSecret,
      repo,
      owner,
    });
  },

  async onDisable(context) {
    const webhook = await context.store.get<WebhookInformation>(
      'github_new_commit_trigger'
    );

    if (webhook !== null && webhook !== undefined) {
      await githubApiCall({
        auth: context.auth,
        method: HttpMethod.DELETE,
        resourceUri: `/repos/${webhook.owner}/${webhook.repo}/hooks/${webhook.webhookId}`,
      });
    }
  },

  async run(context) {
    const storedWebhook = await context.store.get<WebhookInformation>('github_new_commit_trigger');
    if (
      storedWebhook?.webhookSecret &&
      !verifyGithubWebhookSignature(
        storedWebhook.webhookSecret,
        context.payload.headers['x-hub-signature-256'],
        context.payload.rawBody
      )
    ) {
      throw new Error('Webhook signature verification failed. This request may not be from GitHub.');
    }

    const body = context.payload.body as PushPayload;
    if (body.deleted || !body.ref?.startsWith('refs/heads/')) {
      return [];
    }

    const commits = body.commits ?? [];
    // distinct is GitHub’s signal for whether commit is new in push history.
    return commits.filter((commit) => commit.distinct === true);
  },
});

