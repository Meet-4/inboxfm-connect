import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

export const PAGERDUTY_API_BASE_URL = 'https://api.pagerduty.com';
export const PAGERDUTY_ACCEPT_HEADER =
  'application/vnd.pagerduty+json;version=2';

function buildPagerDutyUrl(
  path: string,
  query?: Record<string, string | string[] | undefined>
) {
  const url = new URL(`${PAGERDUTY_API_BASE_URL}${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === '') {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
      } else {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}

export function pagerDutyHeaders(apiKey: string, fromEmail?: string) {
  const headers: Record<string, string> = {
    Authorization: `Token token=${apiKey}`,
    Accept: PAGERDUTY_ACCEPT_HEADER,
    'Content-Type': 'application/json',
  };

  if (fromEmail) {
    headers['From'] = fromEmail;
  }

  return headers;
}

export async function pagerDutyApiCall<T = unknown>(params: {
  apiKey: string;
  method: HttpMethod;
  path: string;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
  fromEmail?: string;
}) {
  const response = await httpClient.sendRequest<T>({
    method: params.method,
    url: buildPagerDutyUrl(params.path, params.query),
    headers: pagerDutyHeaders(params.apiKey, params.fromEmail),
    body: params.body,
  });

  return response.body;
}

/**
 * Creates a PagerDuty v3 webhook subscription delivering the given event
 * types to `webhookUrl`, account-scoped.
 * https://developer.pagerduty.com/api-reference/create-a-webhook-subscription
 */
export async function createWebhookSubscription(
  apiKey: string,
  webhookUrl: string,
  events: string[]
): Promise<string> {
  const result = await pagerDutyApiCall<{
    webhook_subscription: { id: string };
  }>({
    apiKey,
    method: HttpMethod.POST,
    path: '/webhook_subscriptions',
    body: {
      webhook_subscription: {
        type: 'webhook_subscription',
        delivery_method: {
          type: 'http_delivery_method',
          url: webhookUrl,
        },
        events,
        filter: {
          type: 'account_reference',
        },
      },
    },
  });

  const id = result?.webhook_subscription?.id;
  if (!id) {
    throw new Error('PagerDuty did not return a webhook subscription id.');
  }
  return id;
}

/**
 * Deletes a PagerDuty v3 webhook subscription.
 * https://developer.pagerduty.com/api-reference/delete-a-webhook-subscription
 */
export async function deleteWebhookSubscription(
  apiKey: string,
  subscriptionId: string
): Promise<void> {
  await pagerDutyApiCall({
    apiKey,
    method: HttpMethod.DELETE,
    path: `/webhook_subscriptions/${subscriptionId}`,
  });
}
