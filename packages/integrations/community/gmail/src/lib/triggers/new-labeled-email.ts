import {
  createTrigger,
  TriggerStrategy,
  FilesService,
} from '@inboxfm-connect/pieces-framework';
import { GmailProps } from '../common/props';
import { gmailAuth, createGoogleClient } from '../auth';
import { gmail as googleGmail } from '@googleapis/gmail';
import { parseStream, convertAttachment } from '../common/data';
import { newLabeledEmailTriggerOutputSchema } from '../output-schemas';

async function enrichGmailMessage({
  gmail,
  messageId,
  files,
  labelInfo,
}: {
  gmail: any;
  messageId: string;
  files: FilesService;
  labelInfo: {
    labelId: string;
    labelName: string;
  };
}) {
  const rawMailResponse = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'raw',
  });

  const threadResponse = await gmail.users.threads.get({
    userId: 'me',
    id: rawMailResponse.data.threadId!,
  });

  const parsedMailResponse = await parseStream(
    Buffer.from(rawMailResponse.data.raw as string, 'base64').toString('utf-8')
  );

  return {
    message: {
      ...parsedMailResponse,
      attachments: await convertAttachment(
        parsedMailResponse.attachments,
        files
      ),
    },
    thread: threadResponse.data,
    labelInfo: {
      ...labelInfo,
      addedAt: Date.now(),
    },
  };
}

export const gmailNewLabeledEmailTrigger = createTrigger({
  auth: gmailAuth,
  name: 'new_labeled_email',
  displayName: 'New Labeled Email',
  description: 'Triggers when a label is added to an email',
  aiMetadata: {
    description:
      'Fires when the specified label is applied to an email (either newly received with the label or labeled afterward). Each event represents one message that just gained that label, with its parsed contents and label info.',
  },
  props: {
    label: GmailProps.label({
      required: true,
    }),
  },
  outputSchema: newLabeledEmailTriggerOutputSchema,
  sampleData: {
    id: '18d5f2b8c9e0a1f2',
    data: {
      message: {
        from: {
          text: 'Jane Doe <sender@example.com>',
          value: [{ address: 'sender@example.com', name: 'Jane Doe' }],
        },
        to: {
          text: 'recipient@example.com',
          value: [{ address: 'recipient@example.com', name: '' }],
        },
        subject: 'Quarterly Report',
        messageId: '<CAGx7QuarterlyReport7794@example.com>',
        date: '2026-10-15T10:30:00.000Z',
        text: 'Hi team,\n\nHere is the quarterly report...\n\nBest,\nJane',
        html: '<p>Hi team,</p><p>Here is the quarterly report...</p><p>Best,<br>Jane</p>',
        attachments: [],
      },
      thread: {
        id: '18c9f4a1b2e3d4f5',
        snippet: 'Hi team, Here is the quarterly report...',
        historyId: '3547892',
      },
      labelInfo: {
        labelId: 'Label_7',
        labelName: 'Important',
        addedAt: 1760521800000,
      },
    },
  },
  type: TriggerStrategy.POLLING,
  onEnable: async (context) => {
    const authClient = await createGoogleClient(context.auth);
    const gmail = googleGmail({ version: 'v1', auth: authClient });

    const profile = await gmail.users.getProfile({
      userId: 'me',
    });

    await context.store.put('lastHistoryId', profile.data.historyId);
  },
  onDisable: async (context) => {
    await context.store.delete('lastHistoryId');
  },
  run: async (context) => {
    const authClient = await createGoogleClient(context.auth);
    const gmail = googleGmail({ version: 'v1', auth: authClient });

    const lastHistoryId = await context.store.get('lastHistoryId');

    const historyResponse = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: lastHistoryId as string,
      labelId: context.propsValue.label.id,
      historyTypes: ['labelAdded', 'messageAdded'],
    });

    const labeledMessages = new Map<string, string>();
    const results = [];

    if (historyResponse.data.history) {
      for (const history of historyResponse.data.history) {
        if (history.labelsAdded) {
          for (const labelAdded of history.labelsAdded) {
            if (
              labelAdded.labelIds?.includes(context.propsValue.label.id) &&
              labelAdded.message?.id
            ) {
              labeledMessages.set(
                labelAdded.message.id,
                history.id?.toString() || ''
              );
            }
          }
        } else if (history.messagesAdded) {
          for (const messageAdded of history.messagesAdded) {
            if (
              messageAdded.message?.id &&
              messageAdded.message.labelIds?.includes(
                context.propsValue.label.id
              )
            ) {
              labeledMessages.set(
                messageAdded.message.id,
                history.id?.toString() || ''
              );
            }
          }
        }
      }
    }

    for (const [messageId, historyId] of labeledMessages) {
      const enrichedMessage = await enrichGmailMessage({
        gmail,
        messageId,
        files: context.files,
        labelInfo: {
          labelId: context.propsValue.label.id,
          labelName: context.propsValue.label.name,
        },
      });

      if (lastHistoryId !== historyId) {
        results.push({
          id: historyId,
          data: enrichedMessage,
        });
      }
    }

    if (historyResponse.data.historyId) {
      await context.store.put('lastHistoryId', historyResponse.data.historyId);
    }

    return results;
  },
  test: async (context) => {
    const authClient = await createGoogleClient(context.auth);
    const gmail = googleGmail({ version: 'v1', auth: authClient });

    const messagesResponse = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [context.propsValue.label.id],
      maxResults: 5,
    });

    const results = [];

    if (messagesResponse.data.messages) {
      for (const message of messagesResponse.data.messages) {
        const messageId = message.id;
        if (!messageId) {
          continue;
        }
        const enrichedMessage = await enrichGmailMessage({
          gmail,
          messageId: messageId,
          files: context.files,
          labelInfo: {
            labelId: context.propsValue.label.id,
            labelName: context.propsValue.label.name,
          },
        });

        results.push({
          id: messageId,
          data: enrichedMessage,
        });
      }
    }

    return results;
  },
});

