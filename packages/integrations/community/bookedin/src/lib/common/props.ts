import { Property } from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { bookedinAuth } from '../auth';

// BookedIn rebranded to Converti; bookedin.ai (and api.bookedin.ai) no longer resolve.
// The same `/api/v1` surface is served from api.converti.ai with the same X-API-Key auth.
export const BASE_URL = 'https://api.converti.ai/api/v1';

export const getBookedinHeaders = (apiKey: string) => {
  return {
    'X-API-Key': apiKey,
    'accept': 'application/json',
  };
};


export const extractApiKey = (auth: unknown): string => {
  if (typeof auth === 'string') {
    return auth;
  }
  const authObj = auth as { secret_text?: string; auth?: string };
  return authObj?.secret_text || authObj?.auth || '';
};


const fetchLeadOptions = async (apiKey: string) => {
  const response = await httpClient.sendRequest<{
    items: Array<{
      id: string;
      contact: {
        name: {
          first: string;
          last: string;
        };
        email: string;
      };
    }>;
  }>({
    method: HttpMethod.GET,
    url: `${BASE_URL}/leads/`,
    headers: getBookedinHeaders(apiKey),
    queryParams: {
      limit: '100',
      skip: '0',
    },
  });

  return response.body.items.map((lead) => {
    const firstName = lead.contact?.name?.first || '';
    const lastName = lead.contact?.name?.last || '';
    const email = lead.contact?.email || '';
    const name = [firstName, lastName].filter(Boolean).join(' ').trim();
    const label = name ? `${name} (${email})` : email || lead.id;

    return {
      label,
      value: lead.id,
    };
  });
};

export const leadIdDropdown = Property.Dropdown({
  auth: bookedinAuth,
  displayName: 'Lead',
  description: 'Select a lead',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your account first',
        options: [],
      };
    }

    try {
      const apiKey = extractApiKey(auth);
      if (!apiKey) {
        return {
          disabled: true,
          placeholder: 'API key is missing',
          options: [],
        };
      }

      const options = await fetchLeadOptions(apiKey);
      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        placeholder: 'Failed to load leads. Please check your connection.',
        options: [],
      };
    }
  },
});

export const leadIdsMultiSelectDropdown = Property.MultiSelectDropdown({
  auth: bookedinAuth,
  displayName: 'Leads',
  description: 'Select leads to delete (max 500)',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your account first',
        options: [],
      };
    }

    try {
      const apiKey = extractApiKey(auth);
      if (!apiKey) {
        return {
          disabled: true,
          placeholder: 'API key is missing',
          options: [],
        };
      }

      const options = await fetchLeadOptions(apiKey);
      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        placeholder: 'Failed to load leads. Please check your connection.',
        options: [],
      };
    }
  },
});
