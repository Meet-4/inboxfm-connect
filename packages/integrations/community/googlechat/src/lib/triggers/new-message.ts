import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { propsValidation } from '@inboxfm-connect/pieces-common';
import { googleChatApiAuth, googleChatCommon } from '../common';
import { projectsDropdown, spacesDropdown } from '../common/props';
import { googleChatAPIService } from '../common/requests';

export const newMessage = createTrigger({
  auth: googleChatApiAuth,
  name: 'newMessage',
  displayName: 'New Message',
  description: 'Triggers when a new message is received in Google Chat.',
  aiMetadata: {
    description: 'Fires when a new message is posted in Google Chat, delivered via a Pub/Sub webhook subscription. Scope it to a single space, or leave the space unset to listen across all spaces the app can access.',
  },
  props: {
    projectId: projectsDropdown(['auth']),
    spaceId: spacesDropdown({ refreshers: ['auth'] }),
  },
  sampleData: {
    name: 'spaces/AAAAAAAAAAA/messages/UMx0oQ8BnQ4',
    sender: {
      name: 'users/108999999999999999999',
      displayName: 'Jane Doe',
      type: 'HUMAN',
      domainId: 'example.com',
    },
    createTime: '2026-10-15T10:30:05.123Z',
    text: 'Hello team, the Q3 numbers are in!',
    formattedText: 'Hello team, the Q3 numbers are in!',
    argumentText: 'Hello team, the Q3 numbers are in!',
    fallbackText: 'Hello team, the Q3 numbers are in!',
    annotations: [],
    thread: { name: 'spaces/AAAAAAAAAAA/threads/thread1' },
    space: {
      name: 'spaces/AAAAAAAAAAA',
      displayName: 'Project Alpha',
      type: 'ROOM',
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable({ auth, propsValue, webhookUrl, store }) {
    await propsValidation.validateZod(propsValue, googleChatCommon.newMessageTriggerSchema);

    const { projectId, spaceId } = propsValue;
    const accessToken = auth.access_token;

    const topicName = `acp-topic-${Date.now()}`;
    const subscriptionName = `acp-sub-${Date.now()}`;

    await googleChatAPIService
      .cleanupWebhookResources({
        accessToken,
        event_type: 'google.workspace.chat.message.v1.created',
        projectId: projectId as string,
      })
      .catch((err) => {
        console.log('Error cleaning up webhook resources', err);
      });

    await googleChatAPIService.createPubSubTopic({
      accessToken,
      projectId: projectId as string,
      topicName,
    });

    await googleChatAPIService.grantTopicPermissions({
      accessToken,
      projectId: projectId as string,
      topicName,
    });

    const targetResource = `//chat.googleapis.com/${
      spaceId ? spaceId : 'spaces/-'
    }`;

    await googleChatAPIService.createWebhookSubscription({
      accessToken,
      projectId: projectId as string,
      topic: topicName,
      subscriptionName,
      webhookUrl,
      eventTypes: ['google.workspace.chat.message.v1.created'],
      targetResource,
    });
  },
  async onDisable({ auth, propsValue: { projectId }, store }) {
    const accessToken = auth.access_token;

    await googleChatAPIService
      .cleanupWebhookResources({
        accessToken,
        event_type: 'google.workspace.chat.message.v1.created',
        projectId: projectId as string,
      })
      .catch((err) => {
        console.log('Error cleaning up webhook resources during disable', err);
      });
  },
  async run(context) {
    const messageData = JSON.parse(
      Buffer.from(
        (context.payload.body as any).message.data,
        'base64'
      ).toString('utf-8')
    );

    return [messageData];
  },
});

