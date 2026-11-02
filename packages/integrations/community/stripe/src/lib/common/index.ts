import {
  HttpRequest,
  HttpMethod,
  AuthenticationType,
  HttpResponse,
  httpClient,
} from '@inboxfm-connect/pieces-common';
import {
  Property,
  DropdownState,
} from '@inboxfm-connect/pieces-framework';
import { Stripe } from 'stripe';
import { stripeAuth } from '../..';
import {
  StripeCustomerSearchResult,
  StripePaymentIntentSearchResult,
  StripePayout,
  StripeProductSearchResult,
} from './types';

const baseUrl = 'https://api.stripe.com/v1';

// Stripe list endpoints return up to 100 objects per page (limit param) and
// paginate via starting_after/has_more; search endpoints return 10 per page
// (max 100 total) and expose the next page as `next_page`.
// https://docs.stripe.com/api/pagination
const STRIPE_MAX_LIST_ITEMS = 5000;
const STRIPE_SEARCH_MAX_PAGES = 10;

const STRIPE_TRUNCATED_WARNING =
  '⚠️ Could not load all options (partial list)';

function addStripeTruncationWarning<
  T extends { label: string; value: string },
>(options: T[], truncated: boolean): T[] {
  if (truncated) {
    options.push({
      label: STRIPE_TRUNCATED_WARNING,
      value: '__truncated_notice__',
    } as T);
  }
  return options;
}

type StripeSearchResponse<T> = {
  data?: T[];
  has_more?: boolean;
  next_page?: string | null;
};

async function searchAllStripePages<T>({
  apiKey,
  url,
  queryParams,
}: {
  apiKey: string;
  url: string;
  queryParams: Record<string, string>;
}): Promise<{ data: T[]; truncated: boolean }> {
  const data: T[] = [];
  let truncated = false;
  let requestUrl: string | null = url;
  let first = true;
  let pages = 0;

  while (requestUrl && pages < STRIPE_SEARCH_MAX_PAGES) {
    pages++;
    const response: HttpResponse<StripeSearchResponse<T>> =
      await httpClient.sendRequest<StripeSearchResponse<T>>({
        method: HttpMethod.GET,
        url: requestUrl,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: apiKey,
        },
        queryParams: first ? queryParams : undefined,
      });
    first = false;
    if (response.status !== 200) {
      break;
    }
    if (Array.isArray(response.body.data)) {
      data.push(...response.body.data);
    }
    requestUrl = response.body.next_page ?? null;
    if (pages >= STRIPE_SEARCH_MAX_PAGES && requestUrl) {
      truncated = true;
    }
  }

  return { data, truncated };
}

export const getClient = (apiKey: string): Stripe => {
  return new Stripe(apiKey, {
    apiVersion: '2025-05-28.basil',
  });
};

export const stripeCommon = {
  baseUrl: baseUrl,

  subscribeWebhook: async (
    eventName: string,
    webhookUrl: string,
    apiKey: string
  ): Promise<{ id: string }> => {
    const request: HttpRequest = {
      method: HttpMethod.POST,
      url: `${baseUrl}/webhook_endpoints`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: {
        enabled_events: [eventName],
        url: webhookUrl,
      },
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: apiKey,
      },
      queryParams: {},
    };

    const { body: webhook } = await httpClient.sendRequest<{ id: string }>(
      request
    );
    return webhook;
  },

  unsubscribeWebhook: async (webhookId: string, apiKey: string) => {
    const request: HttpRequest = {
      method: HttpMethod.DELETE,
      url: `${baseUrl}/webhook_endpoints/${webhookId}`,
      authentication: {
        type: AuthenticationType.BEARER_TOKEN,
        token: apiKey,
      },
    };
    return await httpClient.sendRequest(request);
  },

  invoice: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Invoice',
    required: true,
    refreshers: [],
    options: async ({ auth }): Promise<DropdownState<string>> => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your Stripe account first',
        };
      }

      try {
        const client = getClient(
          auth.secret_text
        );

        const invoices = await client.invoices
          .list({
            limit: 100,
            expand: ['data.customer'],
          })
          .autoPagingToArray({ limit: STRIPE_MAX_LIST_ITEMS });
        const truncated = invoices.length >= STRIPE_MAX_LIST_ITEMS;

        return {
          disabled: false,
          options: addStripeTruncationWarning(
            invoices
              .map((invoice) => {
                const customer = invoice.customer as Stripe.Customer | null;
                const customerName =
                  customer?.name || customer?.email || 'Unknown Customer';
                const amount = (invoice.total / 100).toFixed(2);
                const label = `Invoice #${
                  invoice.number || invoice.id
                } for ${customerName} (${amount} ${invoice.currency.toUpperCase()})`;
                return {
                  value: invoice.id,
                  label: label,
                };
              })
              .filter(
                (option): option is { value: string; label: string } =>
                  option.value !== undefined && option.value !== null
              ),
            truncated
          ),
        };
      } catch (error) {
        console.error('Failed to load Stripe invoices:', error);
        return {
          disabled: true,
          options: [],
          placeholder: 'Error loading invoices. Check connection.',
        };
      }
    },
  }),

  customer: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Customer',
    required: true,
    refreshers: [],
    options: async ({ auth, searchValue }): Promise<DropdownState<string>> => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account',
        };
      }

      if (searchValue) {
        // Search endpoints return 10 results per page (100 total max) and
        // expose the next page as `next_page`.
        const { data, truncated } = await searchAllStripePages<StripeCustomerSearchResult>(
          {
            apiKey: auth.secret_text,
            url: `${baseUrl}/customers/search`,
            queryParams: {
              query: `name~"${searchValue}" OR email~"${searchValue}"`,
            },
          }
        );

        return {
          disabled: false,
          options: addStripeTruncationWarning(
            data.map((customer) => ({
              value: customer.id,
              label: `${customer.name || customer.id} (${
                customer.email || 'No Email'
              })`,
            })),
            truncated
          ),
        };
      }

      try {
        const client = getClient(auth.secret_text);
        const customers = await client.customers
          .list({ limit: 100 })
          .autoPagingToArray({ limit: STRIPE_MAX_LIST_ITEMS });
        const truncated = customers.length >= STRIPE_MAX_LIST_ITEMS;

        return {
          disabled: false,
          options: addStripeTruncationWarning(
            customers.map((customer) => ({
              value: customer.id,
              label: `${customer.name || customer.id} (${
                customer.email || 'No Email'
              })`,
            })),
            truncated
          ),
        };
      } catch (error) {
        console.error('Failed to load Stripe customers:', error);
        return {
          disabled: true,
          options: [],
          placeholder: "Couldn't load customers",
        };
      }
    },
  }),

  product: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Product',
    required: true,
    refreshers: [],
    options: async ({ auth, searchValue }): Promise<DropdownState<string>> => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account',
        };
      }

      let query = "active:'true'";
      if (searchValue) {
        query += ` AND name~"${searchValue}"`;
      }

      const { data, truncated } =
        await searchAllStripePages<StripeProductSearchResult>({
          apiKey: auth.secret_text,
          url: `${baseUrl}/products/search`,
          queryParams: {
            query: query,
          },
        });

      return {
        disabled: false,
        options: addStripeTruncationWarning(
          data.map((prod: StripeProductSearchResult) => ({
            value: prod.id,
            label: prod.name,
          })),
          truncated
        ),
      };
    },
  }),

  price: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Price',
    required: true,
    refreshers: [],
    options: async ({ auth, searchValue }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account',
        };
      }
      const { data, truncated } = await searchAllStripePages<{
        id: string;
        nickname: string | null;
        product: { name: string };
      }>({
        apiKey: auth.secret_text,
        url: `${baseUrl}/prices/search`,
        queryParams: {
          query: `active:'true' AND type:'recurring' AND (product.name~"${
            searchValue || ''
          }" OR nickname~"${searchValue || ''}")`,
          expand: 'data.product',
        },
      });
      return {
        disabled: false,
        options: addStripeTruncationWarning(
          data.map((price) => {
            const label = price.nickname
              ? `${price.nickname} (${price.product.name})`
              : price.product.name;
            return {
              value: price.id,
              label: label,
            };
          }),
          truncated
        ),
      };
    },
  }),

  subscription: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Subscription',
    required: true,
    refreshers: [],
    options: async ({ auth }): Promise<DropdownState<string>> => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account first',
        };
      }
      try {
        const client = getClient(
          auth.secret_text
        );

        const subscriptions = await client.subscriptions
          .list({
            limit: 100,
            status: 'active',
            expand: ['data.customer'],
          })
          .autoPagingToArray({ limit: STRIPE_MAX_LIST_ITEMS });
        const truncated = subscriptions.length >= STRIPE_MAX_LIST_ITEMS;

        return {
          disabled: false,
          options: addStripeTruncationWarning(
            subscriptions.map((sub) => {
              const customer = sub.customer as Stripe.Customer | null;
              const customerInfo =
                customer?.name || customer?.email || 'Unknown Customer';

              const label = `Subscription for ${customerInfo} (${sub.id})`;

              return {
                value: sub.id,
                label: label,
              };
            }),
            truncated
          ),
        };
      } catch (error) {
        console.error('Failed to load Stripe subscriptions:', error);
        return {
          disabled: true,
          options: [],
          placeholder: "Couldn't load subscriptions. See console.",
        };
      }
    },
  }),

  payout: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Payout',
    required: true,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account',
        };
      }
      try {
        const client = getClient(auth.secret_text);
        const payouts = await client.payouts
          .list({ limit: 100 })
          .autoPagingToArray({ limit: STRIPE_MAX_LIST_ITEMS });
        const truncated = payouts.length >= STRIPE_MAX_LIST_ITEMS;

        return {
          disabled: false,
          options: addStripeTruncationWarning(
            payouts.map((payout) => {
              const arrivalDate = new Date(
                payout.arrival_date * 1000
              ).toLocaleDateString();
              const amount = (payout.amount / 100).toFixed(2);
              const label = `Payout on ${arrivalDate} - ${amount} ${payout.currency.toUpperCase()} (${
                payout.status
              })`;
              return {
                value: payout.id,
                label: label,
              };
            }),
            truncated
          ),
        };
      } catch (error) {
        console.error('Failed to load Stripe payouts:', error);
        return {
          disabled: true,
          options: [],
          placeholder: "Couldn't load payouts",
        };
      }
    },
  }),

  paymentIntent: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Payment Intent',
    required: true,
    refreshers: [],
    options: async ({ auth, searchValue }): Promise<DropdownState<string>> => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account',
        };
      }

      let query = "status:'succeeded'";
      if (searchValue) {
        query += ` AND customer.email~"${searchValue}"`;
      }

      const { data, truncated } =
        await searchAllStripePages<StripePaymentIntentSearchResult>({
          apiKey: auth.secret_text,
          url: `${baseUrl}/payment_intents/search`,
          queryParams: {
            query: query,
            'expand[]': 'data.customer',
          },
        });

      return {
        disabled: false,
        options: addStripeTruncationWarning(
          data.map((intent: StripePaymentIntentSearchResult) => {
            const customerInfo =
              intent.customer?.name ||
              intent.customer?.email ||
              'Unknown Customer';
            const amount = (intent.amount / 100).toFixed(2);
            const label = `Payment from ${customerInfo} - ${amount} ${intent.currency.toUpperCase()}`;
            return {
              value: intent.id,
              label: label,
            };
          }),
          truncated
        ),
      };
    },
  }),

  paymentLink: Property.Dropdown({
  auth: stripeAuth,
    displayName: 'Payment Link',
    required: true,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          options: [],
          placeholder: 'Please connect your account',
        };
      }
      try {
        const client = getClient(auth.secret_text);
        const paymentLinks = await client.paymentLinks
          .list({ active: true, limit: 100 })
          .autoPagingToArray({ limit: STRIPE_MAX_LIST_ITEMS });
        const truncated = paymentLinks.length >= STRIPE_MAX_LIST_ITEMS;

        return {
          disabled: false,
          options: addStripeTruncationWarning(
            paymentLinks.map((link) => ({
              value: link.id,
              label: link.url,
            })),
            truncated
          ),
        };
      } catch (e) {
        return {
          disabled: true,
          options: [],
          placeholder: "Couldn't load payment links",
        };
      }
    },
  }),
};