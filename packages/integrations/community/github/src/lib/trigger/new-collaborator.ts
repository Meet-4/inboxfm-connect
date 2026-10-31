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

export const newCollaboratorTrigger = createTrigger({
  auth: githubAuth,
  name: 'new_collaborator',
  displayName: 'New Collaborator',
  description: 'Triggers when a new collaborator is added to a repository.',
  aiMetadata: {
    description:
      'Fires when a collaborator is added to the chosen repository (member event with action added; other member events are ignored). Represents a user gaining access to the repo.',
  },
  props: {
    repository: githubCommon.repositoryDropdown,
  },
  sampleData: {
    action: 'added',
    member: {
      login: 'octocat',
      id: 1,
      node_id: 'MDQ6VXNlcjE=',
      avatar_url: 'https://github.com/images/error/octocat_happy.gif',
      gravatar_id: '',
      url: 'https://api.github.com/users/octocat',
      html_url: 'https://github.com/octocat',
      type: 'User',
      site_admin: false,
    },
    repository: {
      full_name: 'octocat/Hello-World',
    },
    sender: {
      login: 'admin-user',
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
        events: ['member'],
        config: {
          url: context.webhookUrl,
          content_type: 'json',
          insecure_ssl: '0',
          secret: webhookSecret,
        },
      },
    });

    await context.store.put<WebhookInformation>(
      'github_new_collaborator_trigger',
      {
        webhookId: response.body.id,
        webhookSecret,
        repo: repo,
        owner: owner,
      }
    );
  },
  async onDisable(context) {
    const webhook = await context.store.get<WebhookInformation>(
      'github_new_collaborator_trigger'
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
    const storedWebhook = await context.store.get<WebhookInformation>('github_new_collaborator_trigger');
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

    const payload = context.payload.body as { action?: string };

    if (payload.action === 'added') {
      return [context.payload.body];
    }

    return [];
  },
});

