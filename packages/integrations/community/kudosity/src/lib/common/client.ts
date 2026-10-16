import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

export const BASE_URL = 'https://api.transmitsms.com';

export interface KudosityV1Auth {
  apiKey: string;
  apiSecret: string;
}

// V1 (*.json) endpoints authenticate with HTTP Basic (key:secret) and take
// application/x-www-form-urlencoded bodies — the previous x-api-key + JSON
// combination was rejected with 401 "Authorisation failed".
// Docs: https://developers.kudosity.com/docs/agent-skills
// ("V1 — api.transmitsms.com — HTTP Basic, using your key and secret") and the
// endpoint reference examples, e.g.
// https://developers.kudosity.com/reference/post_edit-list-member-json
export async function makeRequest(
  auth: KudosityV1Auth,
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>
) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body ?? {})) {
    if (value === undefined || value === null) continue;
    form.append(
      key,
      typeof value === 'object' ? JSON.stringify(value) : String(value)
    );
  }

  const basicAuth = Buffer.from(`${auth.apiKey}:${auth.apiSecret}`).toString(
    'base64'
  );

  const response = await httpClient.sendRequest({
    method,
    url: `${BASE_URL}${path}`,
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  return response.body;
}
