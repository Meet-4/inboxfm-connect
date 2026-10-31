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

export const newBranchTrigger = createTrigger({
  auth: githubAuth,
  name: 'new_branch',
  displayName: 'New Branch',
  description: 'Triggers when a new branch is created.',
  aiMetadata: {
    description:
      'Fires when a new branch is created in the chosen repository (GitHub create events of ref type branch; tag creations are ignored). Represents the appearance of a new branch.',
  },
  props: {
    repository: githubCommon.repositoryDropdown,
  },
  sampleData: {
    ref: 'feature/new-design',
    ref_type: 'branch',
    master_branch: 'main',
    description: 'A repository for testing',
    pusher_type: 'user',
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
        events: ['create'],
        config: {
          url: context.webhookUrl,
          content_type: 'json',
          insecure_ssl: '0',
          secret: webhookSecret,
        },
      },
    });

    await context.store.put<WebhookInformation>('github_new_branch_trigger', {
      webhookId: response.body.id,
      webhookSecret,
      repo: repo,
      owner: owner,
    });
  },
  async onDisable(context) {
    const webhook = await context.store.get<WebhookInformation>(
      'github_new_branch_trigger'
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
    const storedWebhook = await context.store.get<WebhookInformation>('github_new_branch_trigger');
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

    const payloadBody = context.payload.body as { ref_type?: string };

    if (payloadBody.ref_type === 'branch') {
      return [context.payload.body];
    }

    return [];
  },
});

