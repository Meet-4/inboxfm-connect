import { createTrigger, TriggerStrategy, PiecePropValueSchema, AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper } from '@inboxfm-connect/pieces-common';
import { HumeClient } from 'hume';
import { humeAiAuth } from '../common/auth';

const polling: Polling<AppConnectionValueForAuthProperty<typeof humeAiAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
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

    // Hume's custom-voice list carries no created/updated timestamps (voice
    // objects expose id/name/provider/generated only —
    // https://dev.hume.ai/docs/text-to-speech-tts/custom-voice), so a
    // TIMEBASED epoch cannot tell a new voice from an already-seen one. The
    // old code stamped Date.now() on every voice and filtered with
    // `return true`, re-emitting the entire list on every poll. Track seen
    // voice ids in the trigger store instead.
    const SEEN_VOICE_IDS_KEY = 'hume_new_voice_seen_ids';
    const seenIds = new Set<string>(
      (await store.get<string[]>(SEEN_VOICE_IDS_KEY)) ?? []
    );
    const newVoices = allVoices.filter(
      (voice) => !seenIds.has(String(voice.id))
    );

    const now = Date.now();
    const items = newVoices.map((voice: any) => ({
      epochMilliSeconds: now,
      data: {
        id: voice.id,
        name: voice.name,
        provider: voice.provider,
        compatibleOctaveModels: voice.compatibleOctaveModels,
      },
    }));

    // `Test step` invokes items() with lastFetchEpochMS = 0; keep it
    // side-effect free and only persist the seen set on real polls.
    if (lastFetchEpochMS > 0) {
      for (const voice of allVoices) {
        seenIds.add(String(voice.id));
      }
      await store.put(SEEN_VOICE_IDS_KEY, Array.from(seenIds).slice(-5000));
    }

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

