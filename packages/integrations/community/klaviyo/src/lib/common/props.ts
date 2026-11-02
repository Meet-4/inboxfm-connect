import { Property } from '@inboxfm-connect/pieces-framework';
import { fetchAllKlaviyoPages } from './client';
import { klaviyoAuth, KlaviyoAuthValue } from './auth';

interface KlaviyoProfile {
  id: string;
  attributes: {
    first_name?: string;
    last_name?: string;
    email?: string;
  };
}

interface KlaviyoList {
  id: string;
  attributes: {
    name?: string;
  };
}

const TRUNCATED_WARNING = '⚠️ Could not load all records (partial list)';

function addTruncationWarning<
  T extends { label: string; value: string },
>(options: T[], truncated: boolean): T[] {
  if (truncated) {
    options.push({
      label: TRUNCATED_WARNING,
      value: '__truncated_notice__',
    } as T);
  }
  return options;
}

export const profileIdDropdown = Property.Dropdown({
  displayName: 'Profile Id',
  required: true,
  auth: klaviyoAuth,
  refreshers: ['auth'],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account',
        options: [],
      };
    }
    const { items: profiles, truncated } = await fetchAllKlaviyoPages(
      auth as KlaviyoAuthValue,
      '/profiles'
    );

    const options = addTruncationWarning(
      (profiles as unknown as KlaviyoProfile[]).map((field) => {
        const firstName = field.attributes.first_name || '';
        const lastName = field.attributes.last_name || '';
        const label = [firstName, lastName].filter(Boolean).join(' ');
        return {
          label: label || field.attributes.email || field.id,
          value: field.id,
        };
      }),
      truncated
    );

    return {
      disabled: false,
      options: options,
    };
  },
});

export const allProfileIdsMultiSelectDropdown = Property.MultiSelectDropdown({
  displayName: 'Profile Ids',
  description: 'Select one or more Klaviyo profiles',
  required: true,
  auth: klaviyoAuth,
  refreshers: ['auth'],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account',
        options: [],
      };
    }
    const { items: profiles, truncated } = await fetchAllKlaviyoPages(
      auth as KlaviyoAuthValue,
      '/profiles'
    );

    const options = addTruncationWarning(
      (profiles as unknown as KlaviyoProfile[]).map((field) => {
        const firstName = field.attributes.first_name || '';
        const lastName = field.attributes.last_name || '';
        const email = field.attributes.email || '';
        const label =
          [firstName, lastName].filter(Boolean).join(' ') +
          (email ? ` (${email})` : '');
        return {
          label: label || field.id,
          value: field.id,
        };
      }),
      truncated
    );

    return { options };
  },
});

export const profileIdsMultiSelectDropdown = Property.MultiSelectDropdown({
  displayName: 'Profile Ids',
  description: 'Select one or more Klaviyo profiles',
  required: true,
  auth: klaviyoAuth,
  refreshers: ['auth','list_id'],
  options: async ({ auth, list_id }) => {
    if (!auth || !list_id) {
      return {
        disabled: true,
        placeholder: 'Connect your account',
        options: [],
      };
    }
    const { items: profiles, truncated } = await fetchAllKlaviyoPages(
      auth as KlaviyoAuthValue,
      `/lists/${list_id}/profiles`
    );

    const options = addTruncationWarning(
      (profiles as unknown as KlaviyoProfile[]).map((field) => {
        const firstName = field.attributes.first_name || '';
        const lastName = field.attributes.last_name || '';
        const email = field.attributes.email || '';
        const label =
          [firstName, lastName].filter(Boolean).join(' ') +
          (email ? ` (${email})` : '');
        return {
          label: label || field.id,
          value: field.id,
        };
      }),
      truncated
    );

    return {
      options,
    };
  },
});

export const listIdDropdown = Property.Dropdown({
  displayName: 'List Id',
  required: true,
  auth: klaviyoAuth,
  refreshers: ['auth'],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Connect your account',
        options: [],
      };
    }

    const { items: lists, truncated } = await fetchAllKlaviyoPages(
      auth as KlaviyoAuthValue,
      '/lists'
    );

    const options = addTruncationWarning(
      (lists as unknown as KlaviyoList[]).map((field) => {
        return {
          label: field.attributes.name || field.id,
          value: field.id,
        };
      }),
      truncated
    );

    return {
      disabled: false,
      options: options,
    };
  },
});

export const countryCode = Property.ShortText({
  displayName: 'Country Code',
  description:
    'Enter 2-letter ISO country code. Popular: US, GB, CA, DE, FR, AU, JP, CN, IN, BR',
  required: false,
});
