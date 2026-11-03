import { createAction, Property } from "@inboxfm-connect/pieces-framework";
import { lushaAuth } from "../../..";

export const enrichCompanies = createAction({
  name: 'enrich_companies',
  auth: lushaAuth,
  displayName: 'Enrich Companies',
  description: 'Enrich companies details using requestId and company IDs from search results',
  audience: 'both',
  aiMetadata: { description: 'Fetch full company profiles from Lusha for the companies returned by a prior Search Companies call, enriching each result batch with the requestId it was returned under. Use after Search Companies when you need detailed company records rather than just match candidates; it requires the raw search-results object and cannot enrich arbitrary company IDs. Read-only lookup and idempotent.', idempotent: true },
  props: {
    searchResults: Property.Json({
      displayName: 'Search Results',
      description: 'The results from the Search Companies step',
      required: true,
    }),
  },
  async run(context) {
    const searchResults = context.propsValue.searchResults as unknown;

    // The Search Companies step returns one { requestId, data } batch per
    // search page. Per the Lusha docs, companies must be enriched with the
    // requestId of the search response that returned them, so each batch is
    // enriched separately. A single batch object is accepted as well.
    const batches = (Array.isArray(searchResults)
      ? searchResults
      : [searchResults]) as Array<{
      requestId?: string;
      data?: Array<{ id: string | number }>;
    }>;

    const enrichedCompanies: unknown[] = [];

    for (const batch of batches) {
      const requestId = batch?.requestId;
      const companyIds = (batch?.data ?? []).map((item) => String(item.id));

      if (!requestId || companyIds.length === 0) {
        continue;
      }

      // The Lusha API accepts at most 100 company IDs per enrich request.
      for (let i = 0; i < companyIds.length; i += 100) {
        const payload = {
          requestId: requestId,
          companiesIds: companyIds.slice(i, i + 100)
        };

        const response = await fetch('https://api.lusha.com/prospecting/company/enrich', {
          method: 'POST',
          headers: {
            'x-app': 'activepieces',
            'api_key': context.auth.secret_text,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const json = await response.json();
        enrichedCompanies.push(...(json.companies ?? []));
      }
    }

    return { companies: enrichedCompanies };
  }
});
