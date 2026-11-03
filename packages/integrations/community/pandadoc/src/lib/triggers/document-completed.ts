import {
  createTrigger,
  TriggerStrategy,
  Property,
} from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { WebhookHandshakeStrategy } from '@inboxfm-connect/pieces-framework';
import { pandadocAuth, pandadocClient } from '../common';

export const documentCompleted = createTrigger({
  name: 'documentCompleted',
  displayName: 'Document Completed',
  description:
    'Triggers when a document is completed.',
  aiMetadata: {
    description: 'Fires when a PandaDoc document is completed — i.e. it reaches the completed state or all recipients finish signing. Optionally scoped to specific templates and/or folders. Represents a fully executed/signed document.',
  },
  auth: pandadocAuth,
  props: {
    template_filter: Property.MultiSelectDropdown({
      auth: pandadocAuth,
      displayName: 'Filter by Templates',
      description:
        'Only trigger for documents created from specific templates (leave empty for all)',
      required: false,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please authenticate first',
            options: [],
          };
        }

        try {
          const response = await pandadocClient.makeRequest<{
            results: Array<{
              id: string;
              name: string;
              date_created: string;
            }>;
          }>(auth.secret_text, HttpMethod.GET, '/templates?count=100');

          const options = response.results.map((template) => ({
            label: `${template.name} - ${template.id.substring(0, 8)}...`,
            value: template.id,
          }));

          return {
            disabled: false,
            options,
          };
        } catch (error) {
          return {
            disabled: true,
            placeholder: 'Failed to load templates',
            options: [],
          };
        }
      },
    }),
    folder_filter: Property.MultiSelectDropdown({
      auth: pandadocAuth,
      displayName: 'Filter by Folders',
      description:
        'Only trigger for documents in specific folders (leave empty for all)',
      required: false,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please authenticate first',
            options: [],
          };
        }

        try {
          const response = await pandadocClient.makeRequest<{
            results: Array<{
              uuid: string;
              name: string;
              date_created: string;
            }>;
          }>(auth.secret_text, HttpMethod.GET, '/documents/folders?count=100');

          const options = response.results.map((folder) => ({
            label: `${folder.name} - ${folder.uuid.substring(0, 8)}...`,
            value: folder.uuid,
          }));

          return {
            disabled: false,
            options,
          };
        } catch (error) {
          return {
            disabled: true,
            placeholder: 'Failed to load folders',
            options: [],
          };
        }
      },
    }),
  },
  sampleData: {
    event_type: 'document_state_changed',
    data: {
      id: 'sample_document_id',
      name: 'Sample Contract',
      status: 'document.completed',
      date_completed: '2024-01-15T10:30:00Z',
      template: {
        id: 'template_id',
        name: 'Contract Template',
      },
      folder_uuid: 'folder_uuid',
      recipients: [
        {
          id: 'recipient_id',
          email: 'client@example.com',
          has_completed: true,
          signature_date: '2024-01-15T10:30:00Z',
        },
      ],
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const webhookSubscription = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: 'https://api.pandadoc.com/public/v1/webhook-subscriptions',
      headers: {
        Authorization: `API-Key ${context.auth.secret_text}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Activepieces Document Completed`,
        url: context.webhookUrl,
        active: true,
        triggers: ['document_state_changed', 'recipient_completed'],
        payload: ['fields', 'products', 'tokens', 'metadata', 'pricing'],
      }),
    });

    await context.store?.put('webhook_id', webhookSubscription.body.uuid);
  },
  async onDisable(context) {
    const webhookId = await context.store?.get('webhook_id');
    if (webhookId) {
      try {
        await httpClient.sendRequest({
          method: HttpMethod.DELETE,
          url: `https://api.pandadoc.com/public/v1/webhook-subscriptions/${webhookId}`,
          headers: {
            Authorization: `API-Key ${context.auth.secret_text}`,
          },
        });
      } catch (error) {
        console.log('Error cleaning up webhook:', error);
      }
    }
  },
  async run(context) {
    const payload = context.payload.body as any;

    // PandaDoc v1 webhook deliveries are a JSON array of event objects:
    // [{ "event": "document_state_changed", "data": { ... } }]
    const events = Array.isArray(payload) ? payload : [payload];

    for (const event of events) {
      if (
        event?.event === 'document_state_changed' &&
        event.data?.status === 'document.completed'
      ) {
        const documentData = event.data;

        if (
          context.propsValue.template_filter &&
          context.propsValue.template_filter.length > 0
        ) {
          const templateId = documentData?.template?.id;
          if (
            !templateId ||
            !context.propsValue.template_filter.includes(templateId)
          ) {
            continue;
          }
        }

        if (
          context.propsValue.folder_filter &&
          context.propsValue.folder_filter.length > 0
        ) {
          const folderUuid = documentData?.folder_uuid;
          if (
            !folderUuid ||
            !context.propsValue.folder_filter.includes(folderUuid)
          ) {
            continue;
          }
        }

        return [documentData];
      }

      if (event?.event === 'recipient_completed') {
        const allCompleted = event.data?.recipients?.every(
          (recipient: any) => recipient.has_completed
        );
        if (allCompleted) {
          const documentData = event.data;

          if (
            context.propsValue.template_filter &&
            context.propsValue.template_filter.length > 0
          ) {
            const templateId = documentData?.template?.id;
            if (
              !templateId ||
              !context.propsValue.template_filter.includes(templateId)
            ) {
              continue;
            }
          }

          if (
            context.propsValue.folder_filter &&
            context.propsValue.folder_filter.length > 0
          ) {
            const folderUuid = documentData?.folder_uuid;
            if (
              !folderUuid ||
              !context.propsValue.folder_filter.includes(folderUuid)
            ) {
              continue;
            }
          }

          return [documentData];
        }
      }
    }

    return [];
  },
  handshakeConfiguration: {
    strategy: WebhookHandshakeStrategy.NONE,
  },
});
