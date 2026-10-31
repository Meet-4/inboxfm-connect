import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  Property,
  OAuth2PropertyValue,
  DropdownOption,
  AppConnectionValueForAuthProperty,
} from '@inboxfm-connect/pieces-framework';
import {
  HttpRequest,
  HttpMethod,
  AuthenticationType,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import { typeformAuth } from '../..';

type FormListResponse = {
  page_count: number;
  total_items: number;
  items: {
    id: string;
    title: string;
  }[];
};

export const formsDropdown = Property.Dropdown<string, true, typeof typeformAuth>({
  auth: typeformAuth,
  displayName: 'Form',
  description: 'Form Name',
  required: true,
  refreshers: [],
  async options({ auth: authentication }) {
    const auth = authentication;

    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect typeform account',
        options: [],
      };
    }

    const accessToken = auth.access_token;

    const options: DropdownOption<string>[] = [];
    let hasMore = true;
    let page = 1;

    do {
      const request: HttpRequest = {
        method: HttpMethod.GET,
        url: 'https://api.typeform.com/forms',
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: accessToken,
        },
        queryParams: {
          page: page.toString(),
          page_size: '200',
        },
      };

      const response = await httpClient.sendRequest<FormListResponse>(request);

      for (const form of response.body.items) {
        options.push({ label: form.title, value: form.id });
      }

      hasMore =
        response.body.page_count != undefined &&
        page < response.body.page_count;

      page++;
    } while (hasMore);

    return {
      disabled: false,
      placeholder: 'Select form',
      options,
    };
  },
});

export const typeformCommon = {
  baseUrl: 'https://api.typeform.com',
  subscribeWebhook: async (
    formId: string,
    tag: string,
    webhookUrl: string,
    accessToken: string,
    secret?: string
  ) => {
    const request: HttpRequest = {
      method: HttpMethod.PUT,
      url: `${typeformCommon.baseUrl}/forms/${formId}/webhooks/${tag}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        enabled: true,
        url: webhookUrl,
        // Typeform only signs deliveries once the webhook's `secret` setting
        // is configured via the Webhooks API.
        // https://www.typeform.com/developers/webhooks/secure-your-webhooks
        ...(secret ? { secret } : {}),
      },
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: accessToken,
      },
      queryParams: {},
    };

    await httpClient.sendRequest(request);
  },
  unsubscribeWebhook: async (
    formId: string,
    tag: string,
    accessToken: string
  ) => {
    const request: HttpRequest = {
      method: HttpMethod.DELETE,
      url: `${typeformCommon.baseUrl}/forms/${formId}/webhooks/${tag}`,
      headers: {
        'Content-Type': 'application/json',
      },
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: accessToken,
      },
    };
    return await httpClient.sendRequest(request);
  },
};

// Typeform signs each delivery once the webhook has a `secret` configured
// (set through the Webhooks API): the `Typeform-Signature` header carries
// `sha256=` + the base64-encoded HMAC-SHA256 of the raw request body.
// https://www.typeform.com/developers/webhooks/secure-your-webhooks
export function generateWebhookSecret(): string {
  // The docs suggest a random hex string (SecureRandom.hex(20)).
  return randomBytes(20).toString('hex');
}

export function verifyTypeformWebhookSignature(
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
  const expected = `sha256=${createHmac('sha256', secret).update(bodyString).digest('base64')}`;
  try {
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const receivedBuffer = Buffer.from(signatureHeader, 'utf8');
    return (
      expectedBuffer.length === receivedBuffer.length &&
      timingSafeEqual(expectedBuffer, receivedBuffer)
    );
  } catch {
    return false;
  }
}
