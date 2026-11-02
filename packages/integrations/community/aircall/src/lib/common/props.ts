import { Property } from '@inboxfm-connect/pieces-framework';
import { makePagedRequest, makeRequest } from './client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { aircallAuth } from './auth';

export const callIdDropdown = Property.Dropdown<string,true,typeof aircallAuth>({
  auth: aircallAuth,
  displayName: 'Call',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your account first',
      };
    }

    try {
      // GET /calls is paginated (default 20 per page, per_page max 50,
      // next page via meta.next_page_link) — walk pages with a bounded
      // budget so the dropdown is not silently capped at the first page.
      // https://support.aircall.io/en-gb/articles/34702023578397
      const { items: calls, truncated } = await makePagedRequest<
        { id: number; raw_digits: string; direction: string }
      >(auth as { username: string; password: string }, '/calls', 'calls');

      const options = calls.map((call) => ({
        label: `${call.raw_digits} - ${call.direction}`,
        value: call.id.toString(),
      }));

      if (truncated) {
        options.push({
          label: '⚠️ Could not load all calls (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading calls.',
      };
    }
  },
});

export const numberIdDropdown = Property.Dropdown<string,true,typeof aircallAuth>({
  auth: aircallAuth,
  displayName: 'Number ID',
  required: true,
  refreshers: ['auth'],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your account first',
      };
    }

    try {
      const response = await makeRequest(
        auth,
        HttpMethod.GET,
        '/numbers'
      );
      return {
        disabled: false,
        options: response.numbers.map((number: any) => ({
          label: number.name,
          value: number.id,
        })),
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading numbers',
      };
    }
  },
});

export const contactIdDropdown = Property.Dropdown<string,true,typeof aircallAuth>({
  auth: aircallAuth,
  displayName: 'Contact ID',
  description: 'Select the contact to update',
  required: true,
  refreshers: ['auth'],

  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your account first',
      };
    }

    try {
      // GET /contacts is paginated like /calls (default 20 per page,
      // per_page max 50, next page via meta.next_page_link) — walk pages
      // with a bounded budget so the dropdown is not silently capped.
      // https://support.aircall.io/en-gb/articles/34702023578397
      const { items: contacts, truncated } = await makePagedRequest<
        { id: string; first_name: string; last_name: string }
      >(auth, '/contacts', 'contacts');

      const options = contacts.map((contact) => ({
        label: `${contact.first_name || ''} ${contact.last_name || ''}` || contact.id,
        value: contact.id,
      }));

      if (truncated) {
        options.push({
          label: '⚠️ Could not load all contacts (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading contacts',
      };
    }
  },
});

export const tagIdDropdown = Property.MultiSelectDropdown<number,false,typeof aircallAuth>({
  auth: aircallAuth,
  displayName: 'Tags',
  required: false,
  refreshers: ['auth'],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your account first',
      };
    }

    try {
      const response = await makeRequest(
        auth as { username: string; password: string },
        HttpMethod.GET,
        '/tags'
      );

      const {tags} = response as {tags:{id:number,name:string}[]}

      return {
        disabled: false,
        options: tags.map((tag) => ({
          label: tag.name,
          value: tag.id,
        })),
      };
    } catch (error) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Error loading tags',
      };
    }
  },
});

