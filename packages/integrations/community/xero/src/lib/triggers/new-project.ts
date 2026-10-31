import {
  TriggerStrategy,
  createTrigger,
  PiecePropValueSchema,
  Property,
  AppConnectionValueForAuthProperty,
} from '@inboxfm-connect/pieces-framework';
import { xeroAuth } from '../..';
import {
  DedupeStrategy,
  httpClient,
  HttpMethod,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { props } from '../common/props';

async function listXeroProjects(
  auth: AppConnectionValueForAuthProperty<typeof xeroAuth>,
  propsValue: Record<string, unknown>
): Promise<any[]> {
    const { access_token } = auth as any;
    const tenantId = propsValue?.['tenant_id'] as string;
    const pageSize = (propsValue?.['page_size'] as number) || 50;
    const contactId = propsValue?.['contact_id'] as string | undefined;
    const states = (propsValue?.['states'] as string[]) || [];

    const results: any[] = [];
    const maxPages = 5;
    for (let page = 1; page <= maxPages; page++) {
      const queryParams: Record<string, string> = {
        page: String(page),
        pageSize: String(pageSize),
      };
      if (contactId) queryParams['contactId'] = contactId;
      if (Array.isArray(states) && states.length > 0) {
        queryParams['states'] = states.join(',');
      }

      const resp = await httpClient.sendRequest<Record<string, any>>({
        method: HttpMethod.GET,
        url: 'https://api.xero.com/projects.xro/2.0/Projects',
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/json',
          'Xero-Tenant-Id': tenantId,
        },
        queryParams,
      });

      if (resp.status !== 200) break;

      const items: any[] = resp.body?.items ?? [];
      for (const it of items) {
        results.push(it);
      }

      if (items.length < pageSize) break;
    }

  return results;
}

const polling: Polling<
AppConnectionValueForAuthProperty<typeof xeroAuth>,
  Record<string, unknown>
> = {
  strategy: DedupeStrategy.TIMEBASED,
  async items({ auth, propsValue }) {
    const projects = await listXeroProjects(auth, propsValue);
    return projects.map((project) => ({ epochMilliSeconds: Date.now(), data: project }));
  },
};

export const xeroNewProject = createTrigger({
  auth: xeroAuth,
  name: 'xero_new_project',
  displayName: 'New Project',
  description: 'Fires when a new project is created.',
  aiMetadata: {
    description: 'Fires when a new project is created in Xero Projects for the connected organisation. Polls the Xero Projects endpoint and emits each project the first time its projectId is seen, optionally filtered by contact or state (INPROGRESS, CLOSED). Each item is a full project record (name, contact, status, estimate). Represents a newly created project, not an update to an existing one.',
  },
  props: {
    tenant_id: props.tenant_id,
    contact_id: props.contact_dropdown(false),
    states: Property.StaticMultiSelectDropdown({
      displayName: 'States (optional)',
      required: false,
      options: {
        options: [
          { label: 'INPROGRESS', value: 'INPROGRESS' },
          { label: 'CLOSED', value: 'CLOSED' },
        ],
      },
    }),
    page_size: Property.Number({ displayName: 'Page Size (1-500)', required: false }),
  },
  type: TriggerStrategy.POLLING,
  async onEnable(context: any) {
    // Baseline existing projects as seen so the first poll after enabling only
    // emits projects created after the trigger is enabled (no first-poll flood).
    const existingProjects = await listXeroProjects(context.auth, context.propsValue);
    if (existingProjects.length > 0) {
      const seenKey = `xero_project_seen_ids_${context.propsValue['tenant_id']}`;
      const existingIds = existingProjects
        .map((project: any) => project?.projectId ?? project?.ProjectID)
        .filter((id: any) => Boolean(id));
      if (existingIds.length > 0) {
        await context.store.put(seenKey, existingIds);
      }
    }
    await pollingHelper.onEnable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  async onDisable(context: any) {
    await pollingHelper.onDisable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  async test(context: any) {
    return await pollingHelper.test(polling, context);
  },
  async run(context: any) {
    const items = (await pollingHelper.poll(polling, context)) as any[];
    const tenantId = context.propsValue['tenant_id'];
    const seenKey = `xero_project_seen_ids_${tenantId}`;
    const seen: string[] = (await context.store.get(seenKey)) || [];

    const results: any[] = [];
    for (const it of items) {
      const id = it?.projectId ?? it?.ProjectID ?? it?.data?.projectId;
      const data = it?.data ?? it;
      const projectId = id as string | undefined;
      if (!projectId) continue;
      if (!seen.includes(projectId)) {
        results.push(data);
        seen.push(projectId);
      }
    }
    await context.store.put(seenKey, seen);
    return results;
  },
  sampleData: undefined,
});


