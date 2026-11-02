import { Property, OAuth2PropertyValue } from '@inboxfm-connect/pieces-framework';
import {
  HttpRequest,
  HttpMethod,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import mailchimp from '@mailchimp/mailchimp_marketing';
import { AuthenticationType } from '@inboxfm-connect/pieces-common';
import crypto from 'crypto';
import { mailchimpAuth } from '../..';

// Mailchimp caps `count` at 1,000 and paginates with `offset`
// https://mailchimp.com/developer/marketing/docs/methods-parameters/#pagination
const MAILCHIMP_PAGE_SIZE = 1000;
const MAILCHIMP_MAX_PAGES = 10;

async function fetchAllMailchimpPages(
  fetchPage: (offset: number) => Promise<Record<string, any>>
): Promise<{
  items: Record<string, any>[];
  totalItems?: number;
  truncated: boolean;
}> {
  const items: Record<string, any>[] = [];
  let truncated = false;
  let offset = 0;
  let pages = 0;
  let totalItems: number | undefined;

  while (pages < MAILCHIMP_MAX_PAGES) {
    pages++;
    const response = (await fetchPage(offset)) ?? {};
    const collectionKey = Object.keys(response).find((key) =>
      Array.isArray(response[key])
    );
    if (!collectionKey) break;
    const pageItems: Record<string, any>[] = response[collectionKey];
    items.push(...pageItems);
    totalItems = response['total_items'];
    if (pageItems.length < MAILCHIMP_PAGE_SIZE) break;
    offset += pageItems.length;
    if (pages >= MAILCHIMP_MAX_PAGES) {
      truncated = true;
    }
  }

  return { items, totalItems, truncated };
}

export const mailchimpCommon = {
  mailChimpListIdDropdown: Property.Dropdown<string,true,typeof mailchimpAuth>({
    auth: mailchimpAuth,
    displayName: 'Audience',
    refreshers: [],
    description: 'Audience you want to add the contact to',
    required: true,
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please select a connection',
        };
      }

      const authProp = auth as OAuth2PropertyValue;
      const listResponse = (await mailchimpCommon.getUserLists(
        authProp
      )) as any;

      const options: { label: string; value: string }[] = listResponse.lists.map(
        (list: any) => ({
          label: list.name,
          value: list.id,
        })
      );
      if (listResponse.truncated) {
        options.push({
          label: '⚠️ Could not load all audiences (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    },
  }),
  getUserLists: async (authProp: OAuth2PropertyValue) => {
    const access_token = authProp.access_token;
    const mailChimpServerPrefix =
      await mailchimpCommon.getMailChimpServerPrefix(access_token!);
    mailchimp.setConfig({
      accessToken: access_token,
      server: mailChimpServerPrefix,
    });

    // Mailchimp caps `count` at 1,000 and paginates with `offset`
    // https://mailchimp.com/developer/marketing/docs/methods-parameters/#pagination
    const { items, totalItems, truncated } = await fetchAllMailchimpPages(
      (offset) =>
        (mailchimp as any).lists.getAllLists({
          fields: ['lists.id', 'lists.name', 'total_items'],
          count: MAILCHIMP_PAGE_SIZE,
          offset,
        })
    );

    return { lists: items, total_items: totalItems, truncated };
  },

  mailChimpCampaignIdDropdown: Property.Dropdown<string,true,typeof mailchimpAuth >({
    auth: mailchimpAuth,
    displayName: 'Campaign',
    refreshers: [],
    description: 'Select the campaign to get information for',
    required: true,
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please select a connection',
        };
      }

      const authProp = auth as OAuth2PropertyValue;
      const campaignResponse = (await mailchimpCommon.getUserCampaigns(
        authProp
      )) as any;

      const options: { label: string; value: string }[] =
        campaignResponse.campaigns.map((campaign: any) => ({
          label: `${campaign.settings?.title || campaign.id} (${campaign.status})`,
          value: campaign.id,
        }));
      if (campaignResponse.truncated) {
        options.push({
          label: '⚠️ Could not load all campaigns (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    },
  }),

  getUserCampaigns: async (authProp: OAuth2PropertyValue) => {
    const access_token = authProp.access_token;
    const mailChimpServerPrefix =
      await mailchimpCommon.getMailChimpServerPrefix(access_token!);
    mailchimp.setConfig({
      accessToken: access_token,
      server: mailChimpServerPrefix,
    });

    const { items, totalItems, truncated } = await fetchAllMailchimpPages(
      (offset) =>
        (mailchimp as any).campaigns.list({
          fields: [
            'campaigns.id',
            'campaigns.settings.title',
            'campaigns.status',
            'total_items',
          ],
          count: MAILCHIMP_PAGE_SIZE,
          offset,
        })
    );

    return { campaigns: items, total_items: totalItems, truncated };
  },

  mailChimpStoreIdDropdown: Property.Dropdown<string,true,typeof mailchimpAuth >({
    auth: mailchimpAuth,
    displayName: 'Store',
    refreshers: [],
    description: 'Select the e-commerce store',
    required: true,
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please select a connection',
        };
      }

      const authProp = auth as OAuth2PropertyValue;
      const storeResponse = (await mailchimpCommon.getUserStores(
        authProp
      )) as any;

      const options: { label: string; value: string }[] = storeResponse.stores.map(
        (store: any) => ({
          label: `${store.name} (${store.id})`,
          value: store.id,
        })
      );
      if (storeResponse.truncated) {
        options.push({
          label: '⚠️ Could not load all stores (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    },
  }),

  getUserStores: async (authProp: OAuth2PropertyValue) => {
    const access_token = authProp.access_token;
    const mailChimpServerPrefix =
      await mailchimpCommon.getMailChimpServerPrefix(access_token!);
    mailchimp.setConfig({
      accessToken: access_token,
      server: mailChimpServerPrefix,
    });

    const { items, totalItems, truncated } = await fetchAllMailchimpPages(
      (offset) =>
        (mailchimp as any).ecommerce.stores({
          fields: ['stores.id', 'stores.name', 'total_items'],
          count: MAILCHIMP_PAGE_SIZE,
          offset,
        })
    );

    return { stores: items, total_items: totalItems, truncated };
  },
  getMailChimpServerPrefix: async (access_token: string) => {
    const mailChimpMetaDataRequest: HttpRequest<{ dc: string }> = {
      method: HttpMethod.GET,
      url: 'https://login.mailchimp.com/oauth2/metadata',
      headers: {
        Authorization: `OAuth ${access_token}`,
      },
    };
    return (await httpClient.sendRequest(mailChimpMetaDataRequest)).body['dc'];
  },
  enableWebhookRequest: async ({
    server,
    token,
    listId,
    webhookUrl,
    events,
  }: EnableTriggerRequestParams): Promise<string> => {
    const response = await httpClient.sendRequest<EnableTriggerResponse>({
      method: HttpMethod.POST,
      url: `https://${server}.api.mailchimp.com/3.0/lists/${listId}/webhooks`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token,
      },
      body: {
        url: webhookUrl,
        events,
        sources: {
          user: true,
          admin: true,
          api: true,
        },
      },
    });

    const { id: webhookId } = response.body;
    return webhookId;
  },
  disableWebhookRequest: async ({
    server,
    token,
    listId,
    webhookId,
  }: DisableTriggerRequestParams): Promise<void> => {
    await httpClient.sendRequest<EnableTriggerResponse>({
      method: HttpMethod.DELETE,
      url: `https://${server}.api.mailchimp.com/3.0/lists/${listId}/webhooks/${webhookId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token,
      },
    });
  },
  getMD5EmailHash: (email: string) => {
    return crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
  },
};

type TriggerRequestParams = {
  server: string;
  token: string;
  listId: string;
};

type EnableTriggerRequestParams = TriggerRequestParams & {
  webhookUrl: string;
  events: object;
};

type DisableTriggerRequestParams = TriggerRequestParams & {
  webhookId: string;
};

type EnableTriggerResponse = {
  id: string;
  url: string;
  list_id: string;
};
