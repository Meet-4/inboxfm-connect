import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { parseurAuth, parseurCommon } from '../common';
import { parserDropdown } from '../common/properties';
import { WebhookInformation } from '../common/types';

export const newTableFieldProcessed = createTrigger({
  auth: parseurAuth,
  name: 'newTableFieldProcessed',
  displayName: 'New Table Field Processed',
  description:
    'Fires when a document with table fields is processed, and triggers for each row (table field) separately.',
  aiMetadata: {
    description:
      'Fires once per table row when a document containing table fields is parsed in the selected Parseur mailbox, emitting each extracted row individually. Use to process line-item or tabular data row by row rather than as a whole document.',
  },
  props: {
    mailboxId: parserDropdown({ required: true }),
  },
  sampleData: [
    {
    sku: 'ABC',
    qty: 2,
    DocumentID: '1e2e34cba5c678a9012f3e456c789a0f',
    },
    {
    sku: 'XYZ',
    qty: 1,
    DocumentID: '1e2e34cba5c678a9012f3e456c789a0f',
    },
  ],
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const response = await parseurCommon.createWebhook({
      apiKey: context.auth.secret_text,
      event: 'table.processed',
      target: context.webhookUrl,
      category: 'CUSTOM',
    });
    await parseurCommon.enableWebhook({
      apiKey: context.auth.secret_text,
      webhookId: response.id,
      mailboxId: context.propsValue.mailboxId as number,
    });
    await context.store.put<WebhookInformation>('_newTableFieldProcessed', {
      webhookId: response.id,
    });
  },
  async onDisable(context) {
    const webhookInfo = await context.store.get<WebhookInformation>(
      '_newTableFieldProcessed'
    );
    if (!webhookInfo) {
      return;
    }
    await parseurCommon.deleteWebhook({
      apiKey: context.auth.secret_text,
      webhookId: webhookInfo.webhookId,
    });
    await context.store.delete('_newTableFieldProcessed');
  },
  async run(context) {
    return [context.payload.body];
  },
});
