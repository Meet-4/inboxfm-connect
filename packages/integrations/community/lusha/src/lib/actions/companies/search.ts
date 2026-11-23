import { createAction, Property } from "@inboxfm-connect/pieces-framework";
import { lushaAuth } from "../../..";

export const searchCompanies = createAction({
  name: 'search_companies',
  auth: lushaAuth,
  displayName: 'Search Companies',
  description: 'Search for companies with filters and pagination',
  audience: 'both',
  aiMetadata: { description: 'Search the Lusha prospecting database for companies matching a JSON filter (industry, size, location, contact countries, etc.), auto-paginating up to a result cap (max 10000). Use to discover company candidates before enriching them; the returned per-page { requestId, data } batches (data = company records with their IDs) feed the Enrich Companies action. Read-only and idempotent for the same filter.', idempotent: true },
  props: {
    resultLimit: Property.Number({
      displayName: 'Maximum Results',
      description: 'Maximum number of companies to return. The maximum is 10000 results.',
      required: true,
      defaultValue: 10000
    }),
    requestBody: Property.Json({
      displayName: 'Request Body',
      description: 'The JSON body for the search request. Do not include pagination (pages), it will be added automatically.',
      required: true,
      defaultValue: {
        "filters": {
          "contacts": {
            "include": {
              "countries": ["ES"]
            }
          },
          "companies": {
            "include": {
              "sizes": [
                {
                  "max": 50,
                  "min": 11
                }
              ],
              "locations": [
                {
                  "country": "Spain"
                }
              ],
              "mainIndustriesIds": [17, 14]
            }
          }
        }
      }
    })
  },
  async run(context) {
    const { resultLimit, requestBody } = context.propsValue;
    
    if (resultLimit > 10000)
      throw new Error(`The maximum of result is 10000`);

    // the maximum number of result is 10000
    // Lusha returns the companies of each page under `companies`, alongside
    // the `requestId` that must be used to enrich these companies.
    const batches: { requestId: string; data: any[] }[] = [];
    let currentPage = 0;
    let hasMorePages = true;
    let fetched = 0;
    
    while (hasMorePages && fetched < resultLimit) {
      const payload = {
        ...requestBody,
        pages: {
          page: currentPage,
          size: 40 // the maximum for the Lusha API
        }
      };
      
      const response = await fetch('https://api.lusha.com/prospecting/company/search', {
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
      
      const responseData = await response.json();

      const companies = Array.isArray(responseData.companies)
        ? responseData.companies
        : [];

      if (companies.length === 0 || !responseData.requestId) {
        hasMorePages = false;
      } else {
        const remainingNeeded = resultLimit - fetched;
        const pageCompanies = remainingNeeded < 40
          ? companies.slice(0, remainingNeeded)
          : companies;
        batches.push({ requestId: responseData.requestId, data: pageCompanies });
        fetched += pageCompanies.length;
      }
      
      currentPage++;
    }
    
    return batches;
  }
});

