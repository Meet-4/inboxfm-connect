import { createHmac, timingSafeEqual } from 'crypto';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import {
  createTrigger,
  Trigger,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { shopifyAuth } from '../..';

// Shopify signs every webhook delivery with the API secret key of the app
// that created the webhook: the `X-Shopify-Hmac-Sha256` header carries the
// base64-encoded HMAC-SHA256 of the raw request body.
// https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
export function verifyShopifyWebhookSignature(
  apiSecretKey: string,
  signatureHeader: string | undefined,
  rawBody: unknown
): boolean {
  if (!signatureHeader) {
    return false;
  }
  let bodyString: string;
  if (typeof rawBody === 'string') {
    bodyString = rawBody;
  } else if (Buffer.isBuffer(rawBody)) {
    bodyString = rawBody.toString('utf8');
  } else if (rawBody === undefined || rawBody === null) {
    bodyString = '';
  } else {
    bodyString = JSON.stringify(rawBody);
  }
  const expected = createHmac('sha256', apiSecretKey)
    .update(bodyString)
    .digest('base64');
  try {
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signatureHeader);
    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  } catch {
    return false;
  }
}

export const createShopifyWebhookTrigger = ({
  name,
  description,
  aiMetadata,
  displayName,
  sampleData,
  topic,
}: {
  name: string;
  description: string;
  aiMetadata?: { description: string };
  displayName: string;
  topic: string;
  sampleData: Record<string, unknown>;
}) =>
  createTrigger({
    auth: shopifyAuth,
    name,
    description,
    aiMetadata,
    displayName,
    props: {},
    sampleData: sampleData,
    type: TriggerStrategy.WEBHOOK,
    async onEnable(context) {
      const shopName = context.auth.props.shopName;
      const response = await httpClient.sendRequest<{
        webhook: {
          id: string;
        };
      }>({
        method: HttpMethod.POST,
        url: `https://${shopName}.myshopify.com/admin/api/2023-01/webhooks.json`,
        headers: {
          'X-Shopify-Access-Token': context.auth.props.adminToken,
        },
        body: {
          webhook: {
            topic: topic,
            address: context.webhookUrl,
            format: 'json',
          },
        },
      });
      await context.store?.put(`shopify_webhook_id`, response.body.webhook.id);
      console.log('webhook created', response.body.webhook.id);
    },
    async onDisable(context) {
      const webhookId = await context.store.get<string>(`shopify_webhook_id`);
      const shopName = context.auth.props.shopName;
      await httpClient.sendRequest<{
        webhook: {
          id: string;
        };
      }>({
        method: HttpMethod.DELETE,
        url: `https://${shopName}.myshopify.com/admin/api/2023-01/webhooks/${webhookId}.json`,
        headers: {
          'X-Shopify-Access-Token': context.auth.props.adminToken,
        },
      });
      await context.store?.put(`shopify_webhook_id`, null);
    },
    async run(context) {
      const apiSecretKey = context.auth.props.webhookSecret;
      if (
        apiSecretKey &&
        !verifyShopifyWebhookSignature(
          apiSecretKey,
          context.payload.headers['x-shopify-hmac-sha256'],
          context.payload.rawBody
        )
      ) {
        throw new Error(
          'Webhook signature verification failed. This request may not be from Shopify.'
        );
      }
      return [context.payload.body];
    },
  });
