import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { scrapegraphaiAuth } from '../auth';

export const markdownify = createAction({
  name: 'markdownify',
  displayName: 'Convert to Markdown',
  description: 'Convert any webpage into clean, readable Markdown format.',
  audience: 'both',
  aiMetadata: { description: 'Fetches a webpage by URL and returns its content as clean, readable Markdown. Choose this when you need the whole page as text for an LLM or document rather than a targeted extraction — use Smart Scraper instead when you want specific fields described by a prompt. Requires a public URL; read-only and safe to retry.', idempotent: true },
  auth: scrapegraphaiAuth,
  props: {
    website_url: Property.ShortText({
      displayName: 'Website URL',
      description: 'The webpage URL to convert to Markdown',
      required: true,
    }),
  },
  async run({ auth, propsValue }) {
    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: 'https://v2-api.scrapegraphai.com/api/scrape',
      headers: {
        'Content-Type': 'application/json',
        'SGAI-APIKEY': auth.secret_text,
      },
      body: {
        url: propsValue.website_url,
        formats: [{ type: 'markdown' }],
      },
    });

    return response.body;
  },
}); 