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

export const newReleaseTrigger = createTrigger({
  auth: githubAuth,
  name: 'new_release',
  displayName: 'New Release',
  description: 'Triggers when a new release is added.',
  aiMetadata: {
    description:
      'Fires when a release is created in the chosen repository (release event filtered to the created action). Represents a newly created release.',
  },
  props: {
    repository: githubCommon.repositoryDropdown,
  },
  sampleData: {
    action: 'published',
    release: {
      url: 'https://api.github.com/repos/octocat/Hello-World/releases/1',
      html_url: 'https://github.com/octocat/Hello-World/releases/v1.0.0',
      id: 1,
      tag_name: 'v1.0.0',
      target_commitish: 'master',
      name: 'v1.0.0',
      body: 'Description of the release',
      draft: false,
      prerelease: false,
      author: { login: 'octocat' },
    },
    repository: { full_name: 'octocat/Hello-World' },
    sender: { login: 'octocat' },
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
        events: ['release'],
        config: {
          url: context.webhookUrl,
          content_type: 'json',
          insecure_ssl: '0',
          secret: webhookSecret,
        },
      },
    });

    await context.store.put<WebhookInformation>('github_new_release_trigger', {
      webhookId: response.body.id,
      webhookSecret,
      repo: repo,
      owner: owner,
    });
  },
  async onDisable(context) {
    const webhook = await context.store.get<WebhookInformation>(
      'github_new_release_trigger'
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
    const storedWebhook = await context.store.get<WebhookInformation>('github_new_release_trigger');
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

    if (payload.action === 'created') {
      return [context.payload.body];
    }

    return [];
  },
});

