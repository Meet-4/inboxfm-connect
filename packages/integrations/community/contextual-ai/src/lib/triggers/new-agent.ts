import { createTrigger, TriggerStrategy, AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper } from '@inboxfm-connect/pieces-common';
import { contextualAiAuth } from '../auth';
import { ContextualAI } from 'contextual-client';
import type { Agent } from 'contextual-client/resources/agents';

const polling: Polling<AppConnectionValueForAuthProperty<typeof contextualAiAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
    const { apiKey, baseUrl } = auth.props;
    const client = new ContextualAI({
      apiKey: apiKey,
      baseURL: baseUrl || 'https://api.contextual.ai/v1',
    });

    const allAgents: Agent[] = [];
    for await (const agent of client.agents.list()) {
      allAgents.push(agent);
    }

    // Contextual's agent list carries no created/updated timestamps (agent
    // objects expose id/name/description only —
    // https://docs.contextual.ai/api-reference/agents/list-agents), so a
    // TIMEBASED epoch cannot tell a new agent from an already-seen one. The
    // old code stamped Date.now() on every agent and filtered with
    // `return true`, re-emitting the entire list on every poll. Track seen
    // agent ids in the trigger store instead.
    const SEEN_AGENT_IDS_KEY = 'contextual_ai_new_agent_seen_ids';
    const seenIds = new Set<string>(
      (await store.get<string[]>(SEEN_AGENT_IDS_KEY)) ?? []
    );
    const newAgents = allAgents.filter((agent) => !seenIds.has(agent.id));

    const now = Date.now();
    const items = newAgents.map((agent: Agent) => ({
      epochMilliSeconds: now,
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
      },
    }));

    // `Test step` invokes items() with lastFetchEpochMS = 0; keep it
    // side-effect free and only persist the seen set on real polls.
    if (lastFetchEpochMS > 0) {
      for (const agent of allAgents) {
        seenIds.add(agent.id);
      }
      await store.put(SEEN_AGENT_IDS_KEY, Array.from(seenIds).slice(-5000));
    }

    return items;
  },
};

export const newAgentTrigger = createTrigger({
  auth: contextualAiAuth,
  name: 'new_agent',
  displayName: 'New Agent',
  description: 'Triggers when a new Contextual AI agent is created',
  aiMetadata: {
    description: 'Fires when a new agent appears in the connected Contextual AI workspace, emitting the agent id, name, and description. Polls the agent list on a schedule, so newly created agents are picked up on the next poll rather than instantly.',
  },
  props: {},
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: 'agent_123',
    name: 'Sample Agent',
    description: 'A sample agent for testing',
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

