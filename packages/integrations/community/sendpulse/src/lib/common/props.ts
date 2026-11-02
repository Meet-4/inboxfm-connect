import { Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { sendpulseApiCall } from './client';
import { sendpulseAuth } from './auth';

type SendpulseMailingList = {
  id: number;
  name: string;
  status_explain: string;
};

export const mailingListDropdown = Property.Dropdown({
  auth: sendpulseAuth,
  displayName: 'Mailing List',
  description: 'Select one of your SendPulse mailing lists',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Please connect your SendPulse account.',
      };
    }
    const typedAuth = auth.props

    try {
      // SendPulse paginates GET /addressbooks with `limit` and `offset`; a
      // single call capped the dropdown at the first 100 mailing lists.
      // Walk the offsets under a bounded budget and surface a notice when
      // the budget is exhausted.
      // https://api.sendpulse.com/
      const PAGE_SIZE = 100;
      const MAX_PAGES = 10;

      const options: { label: string; value: number }[] = [];
      let truncated = false;

      for (let page = 0; page < MAX_PAGES; page++) {
        const lists = await sendpulseApiCall<SendpulseMailingList[]>({
          auth: auth.props,
          method: HttpMethod.GET,
          resourceUri: `/addressbooks?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
        });

        for (const list of lists) {
          options.push({
            label: `${list.name} (${list.status_explain})`,
            value: list.id,
          });
        }

        if (lists.length < PAGE_SIZE) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }

      if (truncated) {
        options.push({
          label: '⚠️ Could not load all mailing lists (partial list)',
          value: '__truncated_notice__' as unknown as number,
        });
      }

      if (!options.length) {
        return {
          disabled: true,
          options: [],
          placeholder: 'No mailing lists found in your account.',
        };
      }

      return {
        disabled: false,
        options,
      };
    } catch (error: any) {
      return {
        disabled: true,
        options: [],
        placeholder: `Failed to load mailing lists: ${error.message}`,
      };
    }
  },
});
