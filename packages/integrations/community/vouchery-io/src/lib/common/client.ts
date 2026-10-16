import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

// Vouchery projects live on their own host, e.g. https://yourproject.vouchery.app/api/v2.1
// (see https://docs.vouchery.io/docs/configuring-testing-webhooks). Keep the sandbox
// host as the fallback so existing sandbox connections keep working.
export const VOUCHERY_DEFAULT_BASE_URL = `https://admin.sandbox.vouchery.app/api/v2.1`;

export function voucheryBaseUrl(projectHost: string | undefined): string {
  const host = (projectHost ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');
  return host ? `https://${host}/api/v2.1` : VOUCHERY_DEFAULT_BASE_URL;
}

export async function makeRequest<T>(
  api_key: string,
  projectHost: string | undefined,
  method: HttpMethod,
  path: string,
  body?: unknown
) {
  try {
    const response = await httpClient.sendRequest<T>({
      method,
      url: `${voucheryBaseUrl(projectHost)}${path}`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api_key}`,
      },
      body,
    });
    return response.body;
  } catch (error: any) {
    throw new Error(`Unexpected error: ${error.message || String(error)}`);
  }
}
