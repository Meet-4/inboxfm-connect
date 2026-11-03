import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';

export const BASE_URL = `https://api.skyprep.io/admin/api`;

export type SkyPrepAuth = {
  api_key: string;
  acct_key: string;
};

export async function makeRequest(
  auth: SkyPrepAuth,
  method: HttpMethod,
  path: string,
  body?: unknown
) {
  try {
    const response = await httpClient.sendRequest({
      method,
      url: `${BASE_URL}${path}`,
      headers: {
        // SkyPrep documented authentication headers (skyprep.com/api):
        // the API key alone is not enough - every call must also identify
        // the account via acct_key, sent as X-SkyPrep-Acct-Key.
        'X-SkyPrep-API-Key': auth.api_key,
        'X-SkyPrep-Acct-Key': auth.acct_key,
        'Content-Type': 'application/json',
      },
      body,
    });

    return response.body;
  } catch (error: any) {
    throw new Error(`Unexpected error: ${error.message || String(error)}`);
  }
}
