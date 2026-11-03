import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { parseurAuth, parseurCommon } from '../common';
import { parserDropdown } from '../common/properties';
import { WebhookInformation } from '../common/types';

export const newDocumentExportFailed = createTrigger({
  auth: parseurAuth,
  name: 'newDocumentExportFailed',
  displayName: 'New Document Export Failed',
  description:
    'Fires when an automated export endpoint (webhook / integration) fails for a processed document.',
  aiMetadata: {
    description:
      'Fires when delivering a successfully parsed document to a configured export target (webhook or downstream integration) fails for the selected Parseur mailbox. Use to detect and handle export/delivery failures.',
  },
  props: { mailboxId: parserDropdown({ required: true }) },
  sampleData: {
    text: 'Export failed for document 1e2e34cba5c678a9012f3e456c789a0f: target endpoint returned 500 Internal Server Error',
    DocumentID: '1e2e34cba5c678a9012f3e456c789a0f',
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const response = await parseurCommon.createWebhook({
      apiKey: context.auth.secret_text,
      event: 'document.export_failed',
      target: context.webhookUrl,
      category: 'CUSTOM',
    });
    await parseurCommon.enableWebhook({
      apiKey: context.auth.secret_text,
      webhookId: response.id,
      mailboxId: context.propsValue.mailboxId as number,
    });
    await context.store.put<WebhookInformation>('_newDocumentExportFailed', {
      webhookId: response.id,
    });
  },
  async onDisable(context) {
    const webhookInfo = await context.store.get<WebhookInformation>(
      '_newDocumentExportFailed'
    );
    if (!webhookInfo) {
      return;
    }
    await parseurCommon.deleteWebhook({
      apiKey: context.auth.secret_text,
      webhookId: webhookInfo.webhookId,
    });
    await context.store.delete('_newDocumentExportFailed');
  },
  async run(context) {
    return [context.payload.body];
  },
});
