import { createTrigger, TriggerStrategy, AppConnectionValueForAuthProperty } from '@inboxfm-connect/pieces-framework';
import { DedupeStrategy, Polling, pollingHelper } from '@inboxfm-connect/pieces-common';
import { contextualAiAuth } from '../auth';
import { ContextualAI } from 'contextual-client';
import type { Agent } from 'contextual-client/resources/agents';

const SEEN_AGENT_IDS_KEY = 'seen_agent_ids';

async function listAgents(
  auth: AppConnectionValueForAuthProperty<typeof contextualAiAuth>
): Promise<Agent[]> {
  const { apiKey, baseUrl } = auth.props;
  const client = new ContextualAI({
    apiKey: apiKey,
    baseURL: baseUrl || 'https://api.contextual.ai/v1',
  });

  const allAgents: Agent[] = [];
  for await (const agent of client.agents.list()) {
    allAgents.push(agent);
  }
  return allAgents;
}

const polling: Polling<AppConnectionValueForAuthProperty<typeof contextualAiAuth>, Record<string, never>> = {
  strategy: DedupeStrategy.TIMEBASED,
  items: async ({ auth, store, lastFetchEpochMS }) => {
    const allAgents = await listAgents(auth);

    // Agents have no created timestamps on the API, so dedupe by id: skip ids
    // already seen in a previous poll and record every listed id. Before this,
    // every existing agent was re-emitted on every poll.
    const isTest = lastFetchEpochMS === 0;
    const seenIds = new Set<string>(
      (await store.get<string[]>(SEEN_AGENT_IDS_KEY)) ?? []
    );
    const newAgents = isTest
      ? allAgents
      : allAgents.filter((agent) => !seenIds.has(agent.id));
    if (!isTest && allAgents.length > 0) {
      await store.put(
        SEEN_AGENT_IDS_KEY,
        allAgents.map((agent) => agent.id)
      );
    }

    const items = newAgents.map((agent: Agent) => ({
      epochMilliSeconds: Date.now(),
      data: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
      },
    }));

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
    // Baseline existing agents as seen so the first poll only emits agents
    // created after the trigger is enabled (no first-poll flood).
    const existingAgents = await listAgents(context.auth);
    if (existingAgents.length > 0) {
      await context.store.put(
        SEEN_AGENT_IDS_KEY,
        existingAgents.map((agent) => agent.id)
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

