import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { Property } from '@inboxfm-connect/pieces-framework';

import { salesloftAuth } from '../auth';
import { salesloftRequest } from './client';

interface SalesloftPerson {
  id?: number;
  email_address?: string;
  display_name?: string;
  first_name?: string;
  last_name?: string;
}

interface SalesloftCadence {
  id?: number;
  name?: string;
}

interface SalesloftUser {
  id?: number;
  name?: string;
  email?: string;
}

interface SalesloftAccount {
  id?: number;
  name?: string;
  domain?: string;
}

/**
 * Salesloft list endpoints page with per_page (max 100) + page
 * (https://developers.salesloft.com/docs/api/people-index).
 * Fetch every page so dropdowns are not truncated at the first 100 records.
 */
const SALESLOFT_DROPDOWN_MAX_PAGES = 10;

async function fetchAllPages<T extends { id?: number }>({
  apiKey,
  path,
}: {
  apiKey: string;
  path: string;
}): Promise<T[]> {
  const records: T[] = [];
  for (let page = 1; page <= SALESLOFT_DROPDOWN_MAX_PAGES; page++) {
    const response = await salesloftRequest<{ data: T[] }>({
      apiKey,
      method: HttpMethod.GET,
      path,
      queryParams: { per_page: '100', page: String(page) },
    });
    const batch = response.data ?? [];
    records.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }
  return records;
}

export const personIdProp = Property.Dropdown({
  displayName: 'Person',
  required: true,
  refreshers: [],
  auth: salesloftAuth,
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your Salesloft account first.',
        options: [],
      };
    }

    const people = await fetchAllPages<SalesloftPerson>({
      apiKey: auth.secret_text,
      path: '/people',
    });

    return {
      disabled: false,
      options: people
        .filter((p) => p.id)
        .map((p) => ({
          label:
            p.email_address ??
            p.display_name ??
            (`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || String(p.id!)),
          value: String(p.id!),
        })),
    };
  },
});

export const cadenceIdProp = Property.Dropdown({
  displayName: 'Cadence',
  required: true,
  refreshers: [],
  auth: salesloftAuth,
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your Salesloft account first.',
        options: [],
      };
    }

    const cadences = await fetchAllPages<SalesloftCadence>({
      apiKey: auth.secret_text,
      path: '/cadences',
    });

    return {
      disabled: false,
      options: cadences
        .filter((c) => c.id)
        .map((c) => ({
          label: c.name ?? String(c.id),
          value: String(c.id!),
        })),
    };
  },
});

export const userIdProp = Property.Dropdown({
  displayName: 'User (Owner)',
  description:
    'Salesloft user who will own this resource. Defaults to the authenticated user if not provided.',
  required: false,
  refreshers: [],
  auth: salesloftAuth,
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your Salesloft account first.',
        options: [],
      };
    }

    const users = await fetchAllPages<SalesloftUser>({
      apiKey: auth.secret_text,
      path: '/users',
    });

    return {
      disabled: false,
      options: users
        .filter((u) => u.id)
        .map((u) => ({
          label: u.name ?? u.email ?? String(u.id),
          value: String(u.id!),
        })),
    };
  },
});

export const accountIdProp = Property.Dropdown({
  displayName: 'Account',
  description: 'Salesloft account to associate with this person.',
  required: false,
  refreshers: [],
  auth: salesloftAuth,
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your Salesloft account first.',
        options: [],
      };
    }

    const accounts = await fetchAllPages<SalesloftAccount>({
      apiKey: auth.secret_text,
      path: '/accounts',
    });

    return {
      disabled: false,
      options: accounts
        .filter((a) => a.id)
        .map((a) => ({
          label: a.name ?? a.domain ?? String(a.id),
          value: String(a.id!),
        })),
    };
  },
});
