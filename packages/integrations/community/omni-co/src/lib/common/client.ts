import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

/**
 * Omni's API is served from each customer's own instance
 * (https://{instance}.omniapp.co/api) — the base URL is the same URL you use
 * to log in to Omni (docs.omni.co/docs/API/overview).
 */
export function omniBaseUrl(instanceUrl: string): string {
  return `${instanceUrl.replace(/\/+$/, '').replace(/\/api$/, '')}/api/v1`;
}

export async function makeRequest(
  auth: { apiKey: string; instanceUrl: string },
  method: HttpMethod,
  path: string,
  body?: unknown
) {
  try {
    const response = await httpClient.sendRequest({
      method,
      url: `${omniBaseUrl(auth.instanceUrl)}${path}`,
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    return response.body;
  } catch (error: any) {
    throw new Error(`Unexpected error: ${error.message || String(error)}`);
  }
}
