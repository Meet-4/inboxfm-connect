import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  AuthenticationType,
  HttpMethod,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import { PiecePropValueSchema } from '@inboxfm-connect/pieces-framework';
import { wooAuth } from '../auth';

export const wooCommon = {
  async createWebhook(
    name: string,
    webhookUrl: string,
    topic: string,
    auth: PiecePropValueSchema<typeof wooAuth>,
    secret?: string
  ) {
    const trimmedBaseUrl = auth.baseUrl.replace(/\/$/, '');
    return await httpClient.sendRequest<WebhookInformation>({
      url: `${trimmedBaseUrl}/wp-json/wc/v3/webhooks`,
      method: HttpMethod.POST,
      body: {
        name: name,
        topic: topic,
        delivery_url: webhookUrl,
        ...(secret ? { secret } : {}),
      },
      authentication: {
        type: AuthenticationType.BASIC,
        username: auth.consumerKey,
        password: auth.consumerSecret,
      },
    });
  },
  async deleteWebhook(
    webhookId: number,
    auth: PiecePropValueSchema<typeof wooAuth>
  ) {
    const trimmedBaseUrl = auth.baseUrl.replace(/\/$/, '');
    return await httpClient.sendRequest({
      url: `${trimmedBaseUrl}/wp-json/wc/v3/webhooks/${webhookId}`,
      method: HttpMethod.DELETE,
      queryParams: { force: 'true' },
      authentication: {
        type: AuthenticationType.BASIC,
        username: auth.consumerKey,
        password: auth.consumerSecret,
      },
    });
  },
};

export interface WebhookInformation {
  id: number;
  name: string;
  status: string;
  topic: string;
  resource: string;
  event: string;
  hooks: string[];
  delivery_url: string;
  date_created: string;
  date_created_gmt: string;
  date_modified: string;
  date_modified_gmt: string;
}

// WooCommerce signs every webhook delivery when the webhook was created with a
// `secret`: the `X-WC-Webhook-Signature` header carries the base64-encoded
// HMAC-SHA256 hash of the raw request body.
// https://woocommerce.com/document/webhooks/#section-6 (Signature)
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

export function verifyWooCommerceWebhookSignature(
  secret: string,
  signatureHeader: string | undefined,
  rawBody: unknown
): boolean {
  if (!signatureHeader) {
    return false;
  }
  const bodyString =
    typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : JSON.stringify(rawBody);
  const expected = createHmac('sha256', secret).update(bodyString).digest('base64');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}
