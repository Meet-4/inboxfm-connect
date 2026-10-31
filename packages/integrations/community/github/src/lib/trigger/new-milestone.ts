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

export const newMilestoneTrigger = createTrigger({
  auth: githubAuth,
  name: 'new_milestone',
  displayName: 'New Milestone',
  description: 'Triggers when a new milestone is created.',
  aiMetadata: {
    description:
      'Fires when a new milestone is created in the chosen repository (milestone event with action created; other milestone changes are ignored). Represents a newly opened milestone.',
  },
  props: {
    repository: githubCommon.repositoryDropdown,
  },
  sampleData: {
    action: 'created',
    milestone: {
      url: 'https://api.github.com/repos/octocat/Hello-World/milestones/1',
      html_url: 'https://github.com/octocat/Hello-World/milestones/v1.0',
      id: 1002604,
      number: 1,
      title: 'v1.0',
      description: 'Tracking milestone for version 1.0',
      creator: { login: 'octocat' },
      open_issues: 0,
      closed_issues: 0,
      state: 'open',
      created_at: '2011-04-10T20:09:31Z',
      updated_at: '2011-04-10T20:09:31Z',
      due_on: '2012-10-09T23:39:01Z',
      closed_at: null,
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
        events: ['milestone'],
        config: {
          url: context.webhookUrl,
          content_type: 'json',
          insecure_ssl: '0',
          secret: webhookSecret,
        },
      },
    });

    await context.store.put<WebhookInformation>(
      'github_new_milestone_trigger',
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
      'github_new_milestone_trigger'
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
    const storedWebhook = await context.store.get<WebhookInformation>('github_new_milestone_trigger');
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

