import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import {
  createTrigger,
  Trigger,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { shopifyAuth } from '../..';

export const createShopifyWebhookTrigger = ({
  name,
  description,
  aiMetadata,
  displayName,
  sampleData,
  topic,
}: {
  name: string;
  description: string;
  aiMetadata?: { description: string };
  displayName: string;
  topic: string;
  sampleData: Record<string, unknown>;
}) =>
  createTrigger({
    auth: shopifyAuth,
    name,
    description,
    aiMetadata,
    displayName,
    props: {},
    sampleData: sampleData,
    type: TriggerStrategy.WEBHOOK,
    async onEnable(context) {
      const shopName = context.auth.props.shopName;
      const response = await httpClient.sendRequest<{
        webhook: {
          id: string;
        };
      }>({
        method: HttpMethod.POST,
        url: `https://${shopName}.myshopify.com/admin/api/2023-01/webhooks.json`,
        headers: {
          'X-Shopify-Access-Token': context.auth.props.adminToken,
        },
        body: {
          webhook: {
            topic: topic,
            address: context.webhookUrl,
            format: 'json',
          },
        },
      });
      await context.store?.put(`shopify_webhook_id_${name}`, response.body.webhook.id);
      console.log('webhook created', response.body.webhook.id);
    },
    async onDisable(context) {
      // The trigger store is flow-scoped, so a shared `shopify_webhook_id`
      // key let multiple Shopify triggers in one flow clobber each other's
      // registration: the last onEnable overwrote every earlier webhook id,
      // and the first onDisable then deleted the wrong webhook. Give each
      // trigger its own store key and fall back to the legacy shared key so
      // webhooks created before this change are still deleted.
      let storeKey = `shopify_webhook_id_${name}`;
      let webhookId = await context.store.get<string>(storeKey);
      if (webhookId === null || webhookId === undefined) {
        storeKey = `shopify_webhook_id`;
        webhookId = await context.store.get<string>(storeKey);
      }
      if (webhookId === null || webhookId === undefined) {
        return;
      }
      const shopName = context.auth.props.shopName;
      await httpClient.sendRequest<{
        webhook: {
          id: string;
        };
      }>({
        method: HttpMethod.DELETE,
        url: `https://${shopName}.myshopify.com/admin/api/2023-01/webhooks/${webhookId}.json`,
        headers: {
          'X-Shopify-Access-Token': context.auth.props.adminToken,
        },
      });
      await context.store?.put(storeKey, null);
    },
    async run(context) {
      return [context.payload.body];
    },
  });
