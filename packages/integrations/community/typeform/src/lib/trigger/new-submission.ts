import {
  generateWebhookSecret,
  typeformCommon,
  verifyTypeformWebhookSignature,
} from '../common';
import { formsDropdown } from '../common';
import { nanoid } from 'nanoid';
import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { getAccessTokenOrThrow } from '@inboxfm-connect/pieces-common';
import { typeformAuth } from '../..';

export const typeformNewSubmission = createTrigger({
  auth: typeformAuth,
  name: 'new_submission',
  displayName: 'New Submission',
  description: 'Triggers when Typeform receives a new submission',
  aiMetadata: {
    description:
      'Fires when a respondent completes and submits the specified Typeform form. The event represents a single finished submission, delivered via webhook, and provides the form response payload including the submission token, landing/submission timestamps, the form definition, and the respondent\'s answers.',
  },
  props: {
    form_id: formsDropdown,
  },
  type: TriggerStrategy.WEBHOOK,
  sampleData: {
    form_id: 'o3TT4IlE',
    token: '9q3v9bp5alonta6239q3q1rfly2c2ukh',
    landed_at: '2023-01-29T20:52:35Z',
    submitted_at: '2023-01-29T20:52:37Z',
    definition: {
      id: 'o3TT4IlE',
      title: 'test2',
      fields: [
        {
          id: 'r2NV4a7LSugq',
          ref: '01GQZMFYAD53N13MC7G0AKFWC6',
          type: 'multiple_choice',
          title: '...',
          properties: {},
          choices: [
            {
              id: 'jNfSosecdD10',
              label: 'Choice 1',
            },
            {
              id: 'pCyKAWMwEbZH',
              label: 'Choice 2',
            },
          ],
        },
      ],
    },
    answers: [
      {
        type: 'choice',
        choice: {
          label: 'Choice 1',
        },
        field: {
          id: 'r2NV4a7LSugq',
          type: 'multiple_choice',
          ref: '01GQZMFYAD53N13MC7G0AKFWC6',
        },
      },
    ],
    thankyou_screen_ref: '01GQZMFYADET9MXFKPGFQG08T9',
  },
  async onEnable(context) {
    const randomTag = `ap_new_submission_${nanoid()}`;
    // Typeform only signs deliveries once the webhook's `secret` setting is
    // configured, so generate one per webhook and send it with the create
    // call. https://www.typeform.com/developers/webhooks/secure-your-webhooks
    const webhookSecret = generateWebhookSecret();
    await typeformCommon.subscribeWebhook(
      context.propsValue['form_id']!,
      randomTag,
      context.webhookUrl,
      getAccessTokenOrThrow(context.auth),
      webhookSecret
    );
    await context.store?.put<WebhookInformation>('_new_submission_trigger', {
      tag: randomTag,
      secret: webhookSecret,
    });
  },
  async onDisable(context) {
    const response = await context.store?.get<WebhookInformation>(
      '_new_submission_trigger'
    );
    if (response !== null && response !== undefined) {
      await typeformCommon.unsubscribeWebhook(
        context.propsValue['form_id']!,
        response.tag,
        getAccessTokenOrThrow(context.auth)
      );
    }
  },
  async run(context) {
    // Typeform signs each delivery with the per-webhook secret generated at
    // onEnable, so fail closed when it is present in the store. Webhooks
    // registered before this change have no stored secret and keep working.
    // https://www.typeform.com/developers/webhooks/secure-your-webhooks
    const storedWebhook = await context.store?.get<WebhookInformation>(
      '_new_submission_trigger'
    );
    if (
      storedWebhook?.secret &&
      !verifyTypeformWebhookSignature(
        storedWebhook.secret,
        context.payload.headers['typeform-signature'],
        context.payload.rawBody
      )
    ) {
      throw new Error(
        'Webhook signature verification failed. This request may not be from Typeform.'
      );
    }
    const body = context.payload.body as { form_response: unknown };
    return [body.form_response];
  },
});

interface WebhookInformation {
  tag: string;
  /** Per-webhook signing secret generated at onEnable and sent to the Webhooks API. */
  secret?: string;
}
