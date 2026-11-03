import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { makeRequest } from '../common/client';
import { webexAuth } from '../common/auth';
export const newMeeting = createTrigger({
  auth: webexAuth,
  name: 'newMeeting',
  displayName: 'New meeting',
  description: 'Triggers when a new meeting is created. ',
  aiMetadata: {
    description:
      'Fires when a new Webex meeting is created, delivering the meeting creation event via webhook.',
  },
  props: {},
  sampleData: {
    id: 'Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1dFQkhPT0svNDk5ZjkxZjItY2QxMi00NTk2LWEzYjctNDY4NTA1OGQ2NTlm',
    name: 'New Meeting Trigger Webhook',
    resource: 'meetings',
    event: 'created',
    orgId: 'Y2lzY29zcGFyazovL3VzL09SR0FOSVpBVElPTi81NWM1YWUzZi04ZDdmLTQyN2ItYTRmOS01ZTNjYjNkZGRmN2I',
    createdBy: 'Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hYzAxZjUzMi1kMDIyLTRmOGUtYTQ5NC0wMGE0ZDc5ZTUyMjc',
    ownedBy: 'creator',
    status: 'active',
    created: '2026-10-15T10:30:01.024Z',
    data: {
      id: '501e995485e2460bb129410116757b13',
      meetingType: 'meeting',
      timezone: 'UTC',
      start: '2026-10-16T20:25:19Z',
      end: '2026-10-16T20:55:19Z',
      hostUserId: 'Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hYzAxZjUzMi1kMDIyLTRmOGUtYTQ5NC0wMGE0ZDc5ZTUyMjc',
      state: 'scheduled',
      hostEmail: 'jane.doe@example.com',
      siteUrl: 'acme.webex.com',
      orgId: '55c5ae3f-8d7f-427b-a4f9-5e3cb3dddf7b',
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const response = await makeRequest(
     context.auth.access_token,
      HttpMethod.POST,
      `/webhooks`,
      {
        event: 'created',
        resource: 'meetings',
        targetUrl: context.webhookUrl,
        name: 'New Meeting Trigger Webhook',
      }
    );

    await context.store.put<WebhookInformation>('webex_new_meeting_trigger_id', {
      id: response.id,
    });
  },
  async onDisable(context) {
    const response = await context.store?.get<WebhookInformation>(
      'webex_new_meeting_trigger_id'
    );
    if (response !== null && response !== undefined) {
      await makeRequest(
       context.auth.access_token,
        HttpMethod.DELETE,
        `/webhooks/${response.id}`
      );
    }
  },
  async run(context) {
    return [context.payload.body];
  },
});

interface WebhookInformation {
  id: string;
}
