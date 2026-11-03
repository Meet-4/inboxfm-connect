import {
  createTrigger,
  TriggerStrategy,
  FilesService,
} from '@inboxfm-connect/pieces-framework';
import { GmailProps } from '../common/props';
import { gmailAuth, createGoogleClient } from '../auth';
import { gmail as googleGmail, gmail_v1 } from '@googleapis/gmail';
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
  sampleData: {},
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

    // history.list paginates (~100 history records per page). Drain every
    // page before advancing the cursor: the response historyId is the
    // mailbox's CURRENT history id, so storing it after reading only the
    // first page would permanently skip label events on later pages.
    let pageToken: string | undefined = undefined;
    let latestHistoryId: string | undefined = undefined;
    const labeledMessages = new Map<string, string>();

    do {
      // Fresh const with an explicit annotation so the call-site argument
      // type does not depend on the loop's flow analysis of pageToken
      // (TS7022: historyResponse would otherwise infer through its own
      // initializer, since pageToken is reassigned from the response).
      const token: string | undefined = pageToken;

      const historyResponse: { data: gmail_v1.Schema$ListHistoryResponse } =
        await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId as string,
        labelId: context.propsValue.label.id,
        historyTypes: ['labelAdded', 'messageAdded'],
        pageToken: token,
      });

      latestHistoryId = historyResponse.data.historyId ?? latestHistoryId;

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

      pageToken = historyResponse.data.nextPageToken ?? undefined;
    } while (pageToken);

    const results = [];

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

    if (latestHistoryId) {
      await context.store.put('lastHistoryId', latestHistoryId);
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

