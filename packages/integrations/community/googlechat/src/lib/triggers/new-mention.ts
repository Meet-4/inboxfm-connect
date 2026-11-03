import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { propsValidation } from '@inboxfm-connect/pieces-common';
import { googleChatApiAuth, googleChatCommon } from '../common';
import { projectsDropdown, spacesDropdown, spacesMembersDropdown } from '../common/props';
import { googleChatAPIService } from '../common/requests';

export const newMention = createTrigger({
  auth: googleChatApiAuth,
  name: 'newMention',
  displayName: 'New Mention',
  description: 'Triggers when a new mention is received in Google Chat.',
  aiMetadata: {
    description: 'Fires when a new message containing an @-mention of a user is posted in Google Chat, delivered via a Pub/Sub webhook subscription. Optionally narrow it to mentions of one specific space member; otherwise it fires on any user mention in the watched space.',
  },
  props: {
    projectId: projectsDropdown(['auth']),
    spaceId: spacesDropdown({refreshers: ['auth']}),
    spaceMemberId: spacesMembersDropdown(['auth', 'spaceId']),
  },
  sampleData: {
    name: 'spaces/AAAAAAAAAAA/messages/UMx0oQ8BnQ5',
    sender: {
      name: 'users/108999999999999999999',
      displayName: 'Alex Jones',
      type: 'HUMAN',
      domainId: 'example.com',
    },
    createTime: '2026-10-15T10:31:02.456Z',
    text: '@Jane Doe please review the Q3 report',
    formattedText: '@Jane Doe please review the Q3 report',
    argumentText: ' please review the Q3 report',
    fallbackText: '@Jane Doe please review the Q3 report',
    annotations: [
      {
        type: 'USER_MENTION',
        startIndex: 0,
        length: 9,
        userMention: {
          user: {
            name: 'users/104998394382000000000',
            displayName: 'Jane Doe',
            type: 'HUMAN',
            isAnonymous: false,
          },
        },
      },
    ],
    thread: { name: 'spaces/AAAAAAAAAAA/threads/thread1' },
    space: {
      name: 'spaces/AAAAAAAAAAA',
      displayName: 'Project Alpha',
      type: 'ROOM',
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable({ auth, propsValue, webhookUrl, store }) {
    await propsValidation.validateZod(propsValue, googleChatCommon.newMentionTriggerSchema);

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

    const { spaceMemberId } = context.propsValue;

    if (!messageData.message?.annotations) {
      return [];
    }

    const mentions = messageData.message.annotations.filter(
      (a: any) => a.type === 'USER_MENTION'
    );

    if (mentions.length === 0) {
      return [];
    }

    if (spaceMemberId) {
      const isMatch = mentions.some(
        (m: any) => m.userMention?.user?.name === spaceMemberId
      );

      if (!isMatch) {
        return [];
      }
    }

    return [messageData];
  },
});

