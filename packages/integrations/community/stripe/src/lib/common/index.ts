import { createHmac, timingSafeEqual } from 'crypto';
import {
  HttpRequest,
  HttpMethod,
  AuthenticationType,
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
  ): Promise<{ id: string; secret: string }> => {
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

    // The signing secret (whsec_...) is only returned by the create call, so
    // capture it here and persist it alongside the webhook id for later
    // signature verification. https://docs.stripe.com/api/webhook_endpoints/create
    const { body: webhook } = await httpClient.sendRequest<{
      id: string;
      secret: string;
    }>(request);
    return webhook;
  },

  // Verifies the `Stripe-Signature` header (t=<timestamp>,v1=<hex signature>)
  // against the endpoint's signing secret: the signature is the hex
  // HMAC-SHA256 of `${timestamp}.${rawBody}`.
  // https://docs.stripe.com/webhooks#verify-official-libraries
  verifyStripeWebhookSignature: (
    secret: string,
    signatureHeader: string | undefined,
    rawBody: unknown
  ): boolean => {
    if (!signatureHeader) {
      return false;
    }
    let timestamp: string | undefined;
    const signatures: string[] = [];
    for (const part of signatureHeader.split(',')) {
      const [key, value] = part.split('=', 2);
      if (key.trim() === 't') {
        timestamp = value;
      } else if (key.trim() === 'v1') {
        signatures.push(value);
      }
    }
    if (!timestamp || signatures.length === 0) {
      return false;
    }
    const bodyString =
      typeof rawBody === 'string'
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf8')
          : JSON.stringify(rawBody);
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${bodyString}`)
      .digest('hex');
    try {
      return signatures.some((signature) =>
        timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
      );
    } catch {
      return false;
    }
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

        const invoices = await client.invoices.list({
          limit: 100,
          expand: ['data.customer'],
        });

        return {
          disabled: false,
          options: invoices.data
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

      const request: HttpRequest = {
        method: HttpMethod.GET,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.secret_text,
        },
        url: searchValue
          ? `${baseUrl}/customers/search`
          : `${baseUrl}/customers`,
        queryParams: searchValue
          ? { query: `name~"${searchValue}" OR email~"${searchValue}"` }
          : { limit: '100' },
      };

      const response = await httpClient.sendRequest<{
        data: StripeCustomerSearchResult[];
      }>(request);

      if (response.status === 200) {
        return {
          disabled: false,
          options: response.body.data.map(
            (customer: StripeCustomerSearchResult) => ({
              value: customer.id,
              label: `${customer.name || customer.id} (${
                customer.email || 'No Email'
              })`,
            })
          ),
        };
      }

      return {
        disabled: true,
        options: [],
        placeholder: "Couldn't load customers",
      };
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

      const response = await httpClient.sendRequest<{
        data: StripeProductSearchResult[];
      }>({
        method: HttpMethod.GET,
        url: `${baseUrl}/products/search`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.secret_text,
        },
        queryParams: {
          query: query,
        },
      });

      if (response.status === 200) {
        return {
          disabled: false,
          options: response.body.data.map(
            (prod: StripeProductSearchResult) => ({
              value: prod.id,
              label: prod.name,
            })
          ),
        };
      }

      return {
        disabled: true,
        options: [],
        placeholder: "Couldn't load products",
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
      const response = await httpClient.sendRequest<{
        data: {
          id: string;
          nickname: string | null;
          product: { name: string };
        }[];
      }>({
        method: HttpMethod.GET,
        url: `${baseUrl}/prices/search`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.secret_text,
        },
        queryParams: {
          query: `active:'true' AND type:'recurring' AND (product.name~"${
            searchValue || ''
          }" OR nickname~"${searchValue || ''}")`,
          expand: 'data.product',
        },
      });
      if (response.status === 200) {
        return {
          disabled: false,
          options: response.body.data.map((price) => {
            const label = price.nickname
              ? `${price.nickname} (${price.product.name})`
              : price.product.name;
            return {
              value: price.id,
              label: label,
            };
          }),
        };
      }
      return {
        disabled: true,
        options: [],
        placeholder: "Couldn't load prices",
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

        const subscriptions = await client.subscriptions.list({
          limit: 100,
          status: 'active',
          expand: ['data.customer'],
        });

        return {
          disabled: false,
          options: subscriptions.data.map((sub) => {
            const customer = sub.customer as Stripe.Customer | null;
            const customerInfo =
              customer?.name || customer?.email || 'Unknown Customer';

            const label = `Subscription for ${customerInfo} (${sub.id})`;

            return {
              value: sub.id,
              label: label,
            };
          }),
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
      const response = await httpClient.sendRequest<{ data: StripePayout[] }>({
        method: HttpMethod.GET,
        url: `${baseUrl}/payouts`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.secret_text,
        },
        queryParams: {
          limit: '100',
        },
      });
      if (response.status === 200) {
        return {
          disabled: false,
          options: response.body.data.map((payout) => {
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
        };
      }
      return {
        disabled: true,
        options: [],
        placeholder: "Couldn't load payouts",
      };
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

      const response = await httpClient.sendRequest<{
        data: StripePaymentIntentSearchResult[];
      }>({
        method: HttpMethod.GET,
        url: `${baseUrl}/payment_intents/search`,
        authentication: {
          type: AuthenticationType.BEARER_TOKEN,
          token: auth.secret_text,
        },
        queryParams: {
          query: query,
          'expand[]': 'data.customer',
        },
      });

      if (response.status === 200) {
        return {
          disabled: false,
          options: response.body.data.map(
            (intent: StripePaymentIntentSearchResult) => {
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
            }
          ),
        };
      }
      return {
        disabled: true,
        options: [],
        placeholder: "Couldn't load payment intents",
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
        const paymentLinks = await client.paymentLinks.list({
          active: true,
          limit: 100,
        });

        return {
          disabled: false,
          options: paymentLinks.data.map((link) => ({
            value: link.id,
            label: link.url,
          })),
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