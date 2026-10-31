import { createTrigger, TriggerStrategy, AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper, HttpMethod } from '@inboxfm-connect/pieces-common';
import { instabaseAuth } from '../auth';

import { makeInstabaseApiCall } from '../common';

const SEEN_CONVERSATION_IDS_KEY = 'seen_conversation_ids';

async function listConversations(
  auth: AppConnectionValueForAuthProperty<typeof instabaseAuth>
): Promise<Conversation[]> {
  const response = await makeInstabaseApiCall<{ conversations: Conversation[] }>(
    auth,
    '/v2/conversations',
    HttpMethod.GET
  );
  return response.conversations || [];
}

type Conversation = {
  id: string;
  name: string;
  description?: string;
};

const polling: Polling<AppConnectionValueForAuthProperty<typeof instabaseAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
    const conversations = await listConversations(auth);

    // Conversations have no created timestamps on the API, so dedupe by id:
    // skip ids already seen in a previous poll and record every listed id.
    // Before this, every existing conversation was re-emitted on every poll.
    const isTest = lastFetchEpochMS === 0;
    const seenIds = new Set<string>(
      (await store.get<string[]>(SEEN_CONVERSATION_IDS_KEY)) ?? []
    );
    const newConversations = isTest
      ? conversations
      : conversations.filter((conversation) => !seenIds.has(conversation.id));
    if (!isTest && conversations.length > 0) {
      await store.put(
        SEEN_CONVERSATION_IDS_KEY,
        conversations.map((conversation) => conversation.id)
      );
    }

    const items = newConversations.map((conversation) => ({
      epochMilliSeconds: Date.now(),
      data: conversation,
    }));
    return items;
  },
};

export const newConversationTrigger = createTrigger({
  auth: instabaseAuth,
  name: 'new_conversation',
  displayName: 'New Conversation',
  description: 'Triggers when a new conversation is created',
  aiMetadata: {
    description: 'Fires when a new conversation is created in the connected Instabase AI Hub account, emitting the conversation. Polls the conversations list on an interval, so newly created conversations surface on the next poll.',
  },
  props: {},
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: 'conv_123',
    name: 'Sample Conversation',
    description: 'A sample conversation for testing',
  },
  async onEnable(context) {
    // Baseline existing conversations as seen so the first poll only emits
    // conversations created after the trigger is enabled (no first-poll flood).
    const existingConversations = await listConversations(context.auth);
    if (existingConversations.length > 0) {
      await context.store.put(
        SEEN_CONVERSATION_IDS_KEY,
        existingConversations.map((conversation) => conversation.id)
      );
    }
    await pollingHelper.onEnable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  async onDisable(context) {
    await pollingHelper.onDisable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  async test(context) {
    return await pollingHelper.test(polling, context);
  },
  async run(context) {
    return await pollingHelper.poll(polling, context);
  },
});

