import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { formIdDropdown } from '../common/props';
import { filloutFormsAuth } from '../auth';
import { makeRequest } from '../common';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { isNil } from '@inboxfm-connect/pieces-framework';

const TRIGGER_KEY = 'new-form-response-trigger';

export const newFormResponse = createTrigger({
  auth: filloutFormsAuth,
  name: 'new-form-response',
  displayName: 'New Form Response',
  description:
    'Triggers when a new submission is received for a selected Fillout form.',
  aiMetadata: {
    description: 'Fires when a new submission is received for the selected Fillout form, delivering the submitted answers, calculations, and metadata. Use to start a workflow whenever someone completes the form.',
  },
  props: {
    formId: formIdDropdown,
  },

  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const { formId } = context.propsValue;
    const apiKey = context.auth.secret_text;

    const response = (await makeRequest(
      apiKey,
      HttpMethod.POST,
      '/webhook/create',
      undefined,
      {
        formId,
        url: context.webhookUrl,
      }
    )) as { id: number };

    await context.store.put<number>(TRIGGER_KEY, response.id);
  },
  async onDisable(context) {
    const apiKey = context.auth.secret_text;

    const webhookId = await context.store.get<number>(TRIGGER_KEY);
    if (!isNil(webhookId)) {
      await makeRequest(apiKey, HttpMethod.POST, '/webhook/delete', undefined, {
        webhookId,
      });
    }
  },
  async test(context) {
    const { formId } = context.propsValue;
    const apiKey = context.auth.secret_text;

    const response = await makeRequest(
      apiKey,
      HttpMethod.GET,
      `/forms/${formId}/submissions`,
      {
        limit: '10',
        sort: 'desc',
      }
    );

    const submissions = response as { responses: Record<string, any>[] };

    return submissions.responses;
  },
  async run(context) {
    // The webhook body may arrive as a raw string (non-JSON content types) or
    // as an already-parsed object; Fillout posts JSON, so parsing a parsed
    // object (the old `JSON.parse(payload.body as string)`) threw on every
    // real event. Per Fillout's docs the webhook body IS the submission (same
    // shape as /submissions entries) — no `submission` wrapper.
    const raw = (context.payload as { body?: unknown }).body ?? context.payload;
    const payload = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
      submission?: Record<string, unknown>;
    } & Record<string, unknown>;
    return [payload.submission ?? payload];
  },
  sampleData: {
    questions: [
      {
        id: '5AtgG35AAZVcrSVfRubvp1',
        name: 'What is your name?',
        type: 'ShortAnswer',
        value: 'John Doe',
      },
      {
        id: 'gRBWVbE2fut2oiAMprdZpY',
        name: 'What is your email?',
        type: 'Email',
        value: 'john@example.com',
      },
      {
        id: 'hP4bHA1CgvyD2LKhBnnGHy',
        name: 'Pick your favorite color',
        type: 'MultipleChoice',
        value: 'Blue',
      },
    ],
    calculations: [
      {
        id: 'abcdef',
        name: 'Price',
        type: 'number',
        value: '12.50',
      },
    ],
    urlParameters: [
      {
        id: 'email',
        name: 'email',
        value: 'john@example.com',
      },
    ],
    submissionId: 'abc123',
    submissionTime: '2024-05-16T23:20:05.324Z',
  },
});

