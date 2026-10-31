import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import {
  generateWebhookSecret,
  githubApiCall,
  githubCommon,
  verifyGithubWebhookSignature,
} from '../common';
import { githubAuth } from '../auth';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

export const githubRegisterTrigger = ({
  name,
  displayName,
  description,
  sampleData,
}: {
  name: string;
  displayName: string;
  description: string;
  sampleData: object;
}) =>
  createTrigger({
    auth: githubAuth,
    name: `trigger_${name}`,
    displayName,
    description,
    aiMetadata: {
      description:
        'Fires on activity for a configured GitHub event type on a chosen repository (one of: pull request, star, issue, push, discussion, or discussion comment, depending on which trigger variant is used). Represents a repository webhook event delivering the raw GitHub event payload.',
    },
    props: {
      repository: githubCommon.repositoryDropdown,
    },
    sampleData,
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
          events: [name],
          config: {
            url: context.webhookUrl,
            content_type: 'json',
            insecure_ssl: '0',
            secret: webhookSecret,
          },
        },
      });

      await context.store.put<WebhookInformation>(`github_${name}_trigger`, {
        webhookId: response.body.id,
        webhookSecret,
        owner: owner,
        repo: repo,
      });
    },
    async onDisable(context) {
      const response = await context.store.get<WebhookInformation>(
        `github_${name}_trigger`
      );
      if (response !== null && response !== undefined) {
        await githubApiCall({
          auth: context.auth,
          method: HttpMethod.DELETE,
          resourceUri: `/repos/${response.owner}/${response.repo}/hooks/${response.webhookId}`,
        });
      }
    },
    async run(context) {
      const storedWebhook = await context.store.get<WebhookInformation>(`github_${name}_trigger`);
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

      if (isVerificationCall(context.payload.body as Record<string, unknown>)) {
        return [];
      }
      return [context.payload.body];
    },
  });

function isVerificationCall(payload: Record<string, any>) {
  return payload['zen'] !== undefined;
}

interface WebhookInformation {
  webhookId: number;
  webhookSecret?: string;
  repo: string;
  owner: string;
}

