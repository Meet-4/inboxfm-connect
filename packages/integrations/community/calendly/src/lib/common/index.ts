import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Property } from '@inboxfm-connect/pieces-framework';
import {
  HttpRequest,
  HttpMethod,
  httpClient,
} from '@inboxfm-connect/pieces-common';

interface CalendlyUser {
  /**User uri */
  uri: string;
  email: string;
  name: string;
  /**Organization uri */
  current_organization: string;
}
export interface CalendlyWebhookInformation {
  webhookId: string;
  /** Per-subscription signing key passed at webhook creation, used to verify deliveries. */
  webhookSecret?: string;
}

export const calendlyCommon = {
  baseUrl: 'https://api.calendly.com',
  scope: Property.StaticDropdown({
    displayName: 'Scope',
    required: true,
    options: {
      options: [
        { value: 'user', label: 'User' },
        { value: 'organization', label: 'Organization' },
      ],
      disabled: false,
    },
  }),
  getUser: async (personalToken: string) => {
    const request: HttpRequest = {
      method: HttpMethod.GET,
      url: `${calendlyCommon.baseUrl}/users/me`,
      headers: {
        Authorization: calendlyCommon.authorizationHeader(personalToken),
      },
    };
    const response = await httpClient.sendRequest<{ resource: CalendlyUser }>(
      request
    );
    return response.body.resource;
  },
  authorizationHeader: (personalToken: string) => `Bearer ${personalToken}`,
  UuidFromUri: (uri: string) => uri.split('/').pop(),
};


// Calendly can sign webhook deliveries with a per-subscription signing key
// (set at creation for personal access tokens): the
// `Calendly-Webhook-Signature` header carries `t=<unix ts>,v1=<hex HMAC-SHA256
// of `${timestamp}.${raw body}`>`.
// https://developer.calendly.com/api-docs/overview/webhooks/webhook-signatures
export function generateWebhookSigningKey(): string {
  return randomBytes(32).toString('base64url');
}

export function verifyCalendlyWebhookSignature(
  signingKey: string,
  signatureHeader: string | undefined,
  rawBody: unknown
): boolean {
  if (!signatureHeader) {
    return false;
  }
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key.trim() === 't') {
      timestamp = value;
    } else if (key.trim() === 'v1') {
      signatures.push(value);
    }
  }
  if (!timestamp || signatures.length === 0) {
    return false;
  }
  const bodyString =
    typeof rawBody === 'string'
      ? rawBody
      : Buffer.isBuffer(rawBody)
        ? rawBody.toString('utf8')
        : JSON.stringify(rawBody);
  const expected = createHmac('sha256', signingKey)
    .update(`${timestamp}.${bodyString}`)
    .digest('hex');
  try {
    return signatures.some((signature) =>
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    );
  } catch {
    return false;
  }
}
