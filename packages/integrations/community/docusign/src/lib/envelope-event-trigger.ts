import { createHmac, timingSafeEqual } from 'crypto';
import { ConnectApi } from 'docusign-esign';

import { docusignAuth } from './auth';
import { createApiClient } from './common';
import {
  createTrigger,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';

type StoredConfig = { connectId: string };

// DocuSign Connect signs each delivery when HMAC security is enabled on the
// Connect configuration: every active HMAC key produces a
// `X-DocuSign-Signature-N` header (N = 1..100) carrying the base64-encoded
// HMAC-SHA256 of the raw request body. A match against any one of the
// signature headers authenticates the delivery.
// https://developers.docusign.com/platform/webhooks/connect/validation-and-security/
// https://developers.docusign.com/platform/webhooks/connect/hmac/
export function verifyDocusignWebhookSignature(
  hmacKey: string,
  headers: Record<string, string>,
  rawBody: unknown
): boolean {
  const bodyString =
    typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : JSON.stringify(rawBody);
  const expected = createHmac('sha256', hmacKey).update(bodyString).digest('base64');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  let matched = false;
  for (const [name, value] of Object.entries(headers)) {
    if (!value || !/^x-docusign-signature-\d+$/i.test(name)) {
      continue;
    }
    const receivedBuffer = Buffer.from(value, 'utf8');
    if (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      matched = true;
    }
  }
  return matched;
}

export function createEnvelopeEventTrigger({
  name,
  displayName,
  description,
  aiMetadata,
  docusignEvent,
  sampleData,
}: {
  name: string;
  displayName: string;
  description: string;
  aiMetadata?: { description: string };
  docusignEvent: string;
  sampleData: Record<string, unknown>;
}) {
  return createTrigger({
    auth: docusignAuth,
    name,
    displayName,
    description,
    aiMetadata,
    type: TriggerStrategy.WEBHOOK,
    props: {
      accountId: Property.ShortText({
        displayName: 'Account ID',
        required: true,
      }),
    },
    sampleData,
    async onEnable(context) {
      const apiClient = await createApiClient(context.auth);
      const connectApi = new ConnectApi(apiClient);

      const result = await connectApi.createConfiguration(
        context.propsValue.accountId,
        {
          connectCustomConfiguration: {
            name: `Activepieces - ${displayName}`,
            urlToPublishTo: context.webhookUrl,
            events: [docusignEvent],
            allowEnvelopePublish: 'true',
            configurationType: 'custom',
            deliveryMode: 'SIM',
            eventData: {
              version: 'restv2.1',
            },
            enableLog: 'true',
          },
        }
      );

      await context.store.put<StoredConfig>(`_docusign_${name}`, {
        connectId: result.connectId as string,
      });
    },
    async onDisable(context) {
      const stored = await context.store.get<StoredConfig>(`_docusign_${name}`);
      if (!stored?.connectId) return;

      const apiClient = await createApiClient(context.auth);
      const connectApi = new ConnectApi(apiClient);

      await connectApi.deleteConfiguration(
        context.propsValue.accountId,
        stored.connectId
      );
    },
    async run(context) {
      // Verify against the optional Connect HMAC key when the connection has
      // one; deliveries pass through unchanged when it is unset (matches the
      // optional-secret rollout used for Shopify).
      // https://developers.docusign.com/platform/webhooks/connect/validate/
      const hmacKey = context.auth.props.webhookSecret;
      if (
        hmacKey &&
        !verifyDocusignWebhookSignature(
          hmacKey,
          context.payload.headers,
          context.payload.rawBody
        )
      ) {
        throw new Error(
          'Webhook signature verification failed. This request may not be from DocuSign.'
        );
      }
      return [context.payload.body];
    },
  });
}

