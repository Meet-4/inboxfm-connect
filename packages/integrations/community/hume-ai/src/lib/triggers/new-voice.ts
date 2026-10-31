import { createTrigger, TriggerStrategy, PiecePropValueSchema, AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper } from '@inboxfm-connect/pieces-common';
import { HumeClient } from 'hume';
import { humeAiAuth } from '../common/auth';

const SEEN_VOICE_IDS_KEY = 'seen_voice_ids';

async function listCustomVoices(
  auth: AppConnectionValueForAuthProperty<typeof humeAiAuth>
): Promise<any[]> {
  const client = new HumeClient({
    apiKey: auth.secret_text,
  });
  const allVoices: any[] = [];
  const pageableResponse = await client.tts.voices.list({
    provider: "CUSTOM_VOICE"
  });
  for await (const voice of pageableResponse) {
    allVoices.push(voice);
  }
  return allVoices;
}

const polling: Polling<AppConnectionValueForAuthProperty<typeof humeAiAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
    const allVoices = await listCustomVoices(auth);

    // Voices have no created timestamps on the API, so dedupe by id: skip ids
    // already seen in a previous poll and record every listed id. Before this,
    // every custom voice was re-emitted on every poll.
    const isTest = lastFetchEpochMS === 0;
    const seenIds = new Set<string>(
      (await store.get<string[]>(SEEN_VOICE_IDS_KEY)) ?? []
    );
    const newVoices = isTest
      ? allVoices
      : allVoices.filter((voice: any) => !seenIds.has(voice.id));
    if (!isTest && allVoices.length > 0) {
      await store.put(
        SEEN_VOICE_IDS_KEY,
        allVoices.map((voice: any) => voice.id)
      );
    }
    const items = newVoices.map((voice: any) => ({
      epochMilliSeconds: Date.now(),
      data: {
        id: voice.id,
        name: voice.name,
        provider: voice.provider,
        compatibleOctaveModels: voice.compatibleOctaveModels,
      },
    }));

    return items;
  },
};

export const newVoiceTrigger = createTrigger({
  auth: humeAiAuth,
  name: 'new_voice',
  displayName: 'New Voice',
  description: 'Triggers when a new voice is created in Hume AI',
  aiMetadata: {
    description: 'Fires when a new custom voice appears in the connected Hume AI account, polling the custom voice list on an interval. Each emitted event represents one newly detected custom voice.',
  },
  props: {},
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: 'voice_123',
    name: 'My Custom Voice',
    provider: 'CUSTOM_VOICE',
    compatibleOctaveModels: ['octave-2'],
  },
  async onEnable(context) {
    // Baseline existing voices as seen so the first poll only emits voices
    // created after the trigger is enabled (no first-poll flood).
    const existingVoices = await listCustomVoices(context.auth);
    if (existingVoices.length > 0) {
      await context.store.put(
        SEEN_VOICE_IDS_KEY,
        existingVoices.map((voice: any) => voice.id)
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

