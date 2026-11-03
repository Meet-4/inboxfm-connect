import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { signrequestAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
export const signrequestSigned = createTrigger({
  auth: signrequestAuth,
  name: 'signrequestSigned',
  displayName: 'signrequest signed',
  description: 'Triggers when a SignRequest signer is signed',
  aiMetadata: { description: 'Fires when a signer completes signing a SignRequest. Use to react once a document has been signed by a party.' },
  props: {},
  sampleData: {
    document: {
      api_used: true,
      attachments: [],
      external_id: 'your_id_of_this_document',
      file: 'https://signrequest.com/api/v1/documents/f2bac751-4fa1-43f1-91de-a1b8905c239a/download/',
      file_from_url: null,
      name: 'nda.pdf',
      pdf: null,
      prefill_tags: [],
      security_hash: null,
      signing_log: null,
      signrequest: null,
      status: 'si',
      team: {
        name: 'the_name_of_your_team',
        subdomain: 'the_subdomain_of_your_team',
      },
      template: null,
      url: 'https://signrequest.com/api/v1/documents/f2bac751-4fa1-43f1-91de-a1b8905c239a/',
      user: null,
      uuid: 'f2bac751-4fa1-43f1-91de-a1b8905c239a',
    },
    event_hash: '89365cda10349ced9c3fd9c457372b37ad2e723c5b9f11a4d0b2c16724d8a2e7',
    event_time: '1762000000',
    event_type: 'signer_signed',
    signer: {
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      order: 1,
      uuid: 'e7b9d0a1-3f45-4c6d-9e8f-0a1b2c3d4e5f',
    },
    status: 'ok',
    team: {
      name: 'the_name_of_your_team',
      subdomain: 'the_subdomain_of_your_team',
    },
    timestamp: '2026-10-15T10:30:00.836457Z',
    token_name: 'Token',
    uuid: 'ffffd4dd-89c7-4133-ba2d-960f65c8d395',
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const apiKey = context.auth.secret_text;
    const body = {
      event_type: 'signer_signed',
      callback_url: context.webhookUrl,
    };
    const response = await makeRequest(
      apiKey,
      HttpMethod.POST,
      '/webhooks/',
      body
    );
    await context.store.put('signrequest_signed_webhook', response.uuid);
  },
  async onDisable(context) {
    const apiKey = context.auth.secret_text;
    const webhookId = await context.store.get<any>(
      'signrequest_signed_webhook'
    );

    if (!webhookId) {
      console.debug('No Signrequest webhook found in store to delete');
      return;
    }

    await makeRequest(apiKey, HttpMethod.DELETE, `/webhooks/${webhookId}/`);
    await context.store.delete('signrequest_signed_webhook');
  },
  async run(context) {
    const body = context.payload.body as any;
    if (body.event_type !== 'signer_signed') {
      return [];
    }
    return [context.payload.body];
  },
});
