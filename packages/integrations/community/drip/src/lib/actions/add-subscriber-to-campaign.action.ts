import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import {
  HttpRequest,
  HttpMethod,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import { dripCommon } from '../common';
import { dripAuth } from '../auth';

export const dripAddSubscriberToCampaign = createAction({
  auth: dripAuth,
  name: 'add_subscriber_to_campaign',
  description: 'Add a subscriber to a campaign (Email series)',
  audience: 'both',
  aiMetadata: { description: 'Subscribes a contact (by email) to a Drip email-series campaign in the given account, optionally attaching tags and custom fields. Use to enroll someone into an automated email sequence. Requires an existing campaign id (selectable from the account). Not idempotent: each call re-subscribes and can re-trigger the series.', idempotent: false },
  displayName: 'Add a subscriber to a campaign',
  props: {
    account_id: dripCommon.account_id,
    campaign_id: Property.Dropdown({
      displayName: 'Email Series Campaign',
      auth: dripAuth,
      refreshers: ['account_id'],
      required: true,
      options: async ({ auth, account_id }) => {
        if (!auth) {
          return {
            disabled: true,
            options: [],
            placeholder: 'Please fill in API key first',
          };
        }
        if (!account_id) {
          return {
            disabled: true,
            options: [],
            placeholder: 'Please select an account first',
          };
        }
        // Drip v2 paginates every collection with `page` / `per_page`
        // (default 100 per page); a single call capped the dropdown at the
        // first 100 campaigns. Walk the pages under a bounded budget and
        // surface a notice when the budget is exhausted.
        // https://developer.drip.com/
        const PAGE_SIZE = 100;
        const MAX_PAGES = 10;

        const opts: { value: string; label: string }[] = [];
        let truncated = false;

        for (let page = 1; page <= MAX_PAGES; page++) {
          const request: HttpRequest = {
            method: HttpMethod.GET,
            url: `${dripCommon.baseUrl(account_id as string)}/campaigns?page=${page}&per_page=${PAGE_SIZE}`,
            headers: {
              Authorization: `Basic ${Buffer.from(auth.secret_text).toString(
                'base64'
              )}`,
            },
          };
          const response = await httpClient.sendRequest<{
            campaigns: { name: string; id: string }[];
          }>(request);
          const batch = response.body.campaigns ?? [];
          for (const campaign of batch) {
            opts.push({ value: campaign.id, label: campaign.name });
          }
          if (batch.length < PAGE_SIZE) break;
          if (page === MAX_PAGES) truncated = true;
        }

        if (truncated) {
          opts.push({
            value: '__truncated_notice__',
            label: '⚠️ Could not load all campaigns (partial list)',
          });
        }
        if (opts.length === 0) {
          return {
            disabled: false,
            options: [],
            placeholder: 'Please create an email series campaign',
          };
        }
        return {
          disabled: false,
          options: opts,
        };
      },
    }),
    subscriber: dripCommon.subscriber,
    tags: dripCommon.tags,
    custom_fields: dripCommon.custom_fields,
  },
  async run({ auth, propsValue }) {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `${dripCommon.baseUrl(propsValue.account_id)}/campaigns/${
        propsValue.campaign_id
      }/subscribers`,
      body: {
        subscribers: [
          {
            email: propsValue.subscriber,
            tags: propsValue.tags,
            custom_fields: propsValue.custom_fields,
          },
        ],
      },
      headers: {
        Authorization: dripCommon.authorizationHeader(auth),
      },
      queryParams: {},
    };
    return await httpClient.sendRequest<Record<string, never>>(request);
  },
});

