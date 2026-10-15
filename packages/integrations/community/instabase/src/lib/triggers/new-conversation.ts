import { createTrigger, TriggerStrategy, AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper, HttpMethod } from '@inboxfm-connect/pieces-common';
import { instabaseAuth } from '../auth';
import { makeInstabaseApiCall } from '../common';

type Conversation = {
  id: string;
  name: string;
  description?: string;
};

// Keep only the newest ids in the dedup set so it cannot grow unboundedly
// across polls (house pattern: coralogix SEEN_INCIDENT_IDS_LIMIT).
const SEEN_CONVERSATION_IDS_LIMIT = 1000;
const SEEN_CONVERSATION_IDS_KEY = 'seen_conversation_ids';
const SEEN_CONVERSATION_IDS_SEEDED_KEY = 'seen_conversation_ids_seeded';

const polling: Polling<AppConnectionValueForAuthProperty<typeof instabaseAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
    const response = await makeInstabaseApiCall<{ conversations: Conversation[] }>(
      auth,
      '/v2/conversations',
      HttpMethod.GET
    );

    const conversations = response.conversations || [];
    const isTest = lastFetchEpochMS === 0;

    const storedSeenIds = (await store.get<string[]>(SEEN_CONVERSATION_IDS_KEY)) || [];
    const seeded = await store.get<boolean>(SEEN_CONVERSATION_IDS_SEEDED_KEY);

    // Start-empty guard: the conversation list carries no timestamps, so the
    // trigger dedupes by identity and stamps events with the observation
    // time (always newer than the lastPoll cursor, so the polling helper's
    // time filter passes them). Without this guard, the first poll after
    // enable would emit every pre-existing conversation; the same stamping
    // would then re-emit the whole list on every subsequent poll.
    if (!seeded) {
      if (isTest) {
        // Test path before the first poll: show the current list without
        // initializing the dedupe set.
        return conversations.map((conversation) => ({
          epochMilliSeconds: Date.now(),
          data: conversation,
        }));
      }
      await store.put(
        SEEN_CONVERSATION_IDS_KEY,
        conversations.map((conversation) => conversation.id).slice(-SEEN_CONVERSATION_IDS_LIMIT)
      );
      await store.put(SEEN_CONVERSATION_IDS_SEEDED_KEY, true);
      return [];
    }

    const seenIds = new Set<string>(storedSeenIds);
    const newConversations = conversations.filter((conversation) => !seenIds.has(conversation.id));

    if (!isTest) {
      // Newest ids last, so the slice keeps the most recently seen ones.
      const mergedIds = Array.from(
        new Set([...storedSeenIds, ...conversations.map((conversation) => conversation.id)])
      ).slice(-SEEN_CONVERSATION_IDS_LIMIT);
      await store.put(SEEN_CONVERSATION_IDS_KEY, mergedIds);
    }

    const items = newConversations.map((conversation) => ({
      epochMilliSeconds: Date.now(),
      data: conversation,
    }));

    return isTest ? items : items.filter((item) => item.epochMilliSeconds > lastFetchEpochMS);
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

