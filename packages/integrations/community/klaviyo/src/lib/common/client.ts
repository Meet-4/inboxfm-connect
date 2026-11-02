import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';
import { KlaviyoAuthValue, getAuthorizationHeader } from './auth';

export async function fetchProfilesByIds(
  auth: KlaviyoAuthValue,
  ids: string[]
): Promise<Map<string, Record<string, unknown>>> {
  const CHUNK_SIZE = 100;
  const profileMap = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const params = new URLSearchParams();
    params.set('filter', `any(id,${JSON.stringify(chunk)})`);
    params.set('page[size]', String(CHUNK_SIZE));

    const response = await makeRequest(auth, HttpMethod.GET, `/profiles?${params.toString()}`);
    for (const profile of (response.data as any[]) ?? []) {
      profileMap.set(profile.id as string, profile.attributes as Record<string, unknown>);
    }
  }

  return profileMap;
}

export function normalizeProfileIds(value: unknown): string[] {
  if (Array.isArray(value)) return (value as string[]).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return (parsed as string[]).filter(Boolean);
      } catch {
        // not a JSON array, fall through to treat as single ID
      }
    }
    return [trimmed].filter(Boolean);
  }
  return [];
}

export const BASE_URL = `https://a.klaviyo.com/api`;

async function sendKlaviyoRequest(
  auth: KlaviyoAuthValue,
  method: HttpMethod,
  url: string,
  body?: unknown
) {
  try {
    const response = await httpClient.sendRequest({
      method,
      url,
      headers: {
        Authorization: getAuthorizationHeader(auth),
        accept: 'application/vnd.api+json',
        'content-type': 'application/vnd.api+json',
        revision: '2025-04-15',
      },
      body,
    });
    return response.body;
  } catch (error: any) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      throw new Error(
        'Authentication failed. Please check your API key or access token.'
      );
    }

    if (error.response?.status === 429) {
      throw new Error('Rate limit exceeded. Please wait and try again.');
    }

    if (error.response?.status >= 400 && error.response?.status < 500) {
      throw new Error(
        `Client error: ${
          error.response?.body?.message || JSON.stringify(error.response?.body)
        }`
      );
    }

    if (error.response?.status >= 500) {
      throw new Error('Server error from Klaviyo API. Please try again later.');
    }

    throw new Error(`Unexpected error: ${error.message || String(error)}`);
  }
}

export async function makeRequest(
  auth: KlaviyoAuthValue,
  method: HttpMethod,
  path: string,
  body?: unknown
) {
  return sendKlaviyoRequest(auth, method, `${BASE_URL}${path}`, body);
}

/**
 * Klaviyo paginates list endpoints with `page[cursor]` (default page size is
 * 20, max 100) and returns the next page as an absolute `links.next` URL
 * https://developers.klaviyo.com/en/reference/api_overview#pagination
 */
export async function fetchAllKlaviyoPages(
  auth: KlaviyoAuthValue,
  path: string,
  opts?: { pageSize?: number; maxPages?: number }
): Promise<{ items: Record<string, any>[]; truncated: boolean }> {
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 50;
  const joiner = path.includes('?') ? '&' : '?';
  let url: string | null = `${BASE_URL}${path}${joiner}page[size]=${pageSize}`;
  const items: Record<string, any>[] = [];
  let truncated = false;
  let pages = 0;

  while (url && pages < maxPages) {
    pages++;
    const body = (await sendKlaviyoRequest(
      auth,
      HttpMethod.GET,
      url
    )) as Record<string, any>;
    if (Array.isArray(body?.data)) {
      items.push(...body.data);
    }
    url = body?.links?.next ?? null;
    if (pages >= maxPages && url) {
      truncated = true;
    }
  }

  return { items, truncated };
}

