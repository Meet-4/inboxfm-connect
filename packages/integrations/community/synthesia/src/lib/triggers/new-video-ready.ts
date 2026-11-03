import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { synthesiaAuth } from '../common/auth';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';

interface WebhookData {
  webhookId: string;
}

export const newVideoReady = createTrigger({
  auth: synthesiaAuth,
  name: 'newVideoReady',
  displayName: 'New Video Ready',
  description: 'Trigger when a new video is completed in Synthesia',
  aiMetadata: {
    description:
      'Fires when a Synthesia video finishes rendering and becomes ready (the video.completed event), delivered via a registered webhook. Represents a single completed video; use it to act on a video once generation has finished.',
  },
  props: {},
  sampleData: {
    type: 'video.completed',
    data: {
      id: '9b8c7d6e-5f4a-4321-9876-abcdefabcdef',
      title: 'Hello, World!',
      description: 'This is my first synthetic video, made with the Synthesia API!',
      status: 'complete',
      visibility: 'private',
      callbackId: 'jane.doe@example.com',
      createdAt: 1762000000,
      lastUpdatedAt: 1762000500,
      duration: '0:00:59.000000',
      download: 'https://download.synthesia.io/videos/9b8c7d6e.mp4',
      thumbnail: {
        image: 'https://thumbnails.synthesia.io/9b8c7d6e.jpg',
        gif: 'https://thumbnails.synthesia.io/9b8c7d6e.gif',
      },
      captions: {
        srt: 'https://captions.synthesia.io/9b8c7d6e.srt',
        vtt: 'https://captions.synthesia.io/9b8c7d6e.vtt',
      },
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const webhookUrl = context.webhookUrl;
    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: 'https://api.synthesia.io/v2/webhooks',
      headers: {
        Authorization: `Bearer ${context.auth.secret_text}`,
        'Content-Type': 'application/json',
      },
      body: {
        url: webhookUrl,
        events: ['video.completed'],
      },
    });

    await context.store.put<WebhookData>('webhookData', {
      webhookId: response.body.id,
    });
  
  },
  async onDisable(context) {
    const webhookData = await context.store.get<WebhookData>('webhookData');
    if (webhookData) {
      await httpClient.sendRequest({
        method: HttpMethod.DELETE,
        url: `https://api.synthesia.io/v2/webhooks/${webhookData.webhookId}`,
        headers: {
          Authorization: `Bearer ${context.auth.secret_text}`,
          'Content-Type': 'application/json',
        },
      });
    }
    await context.store.delete('webhookData');
  },
  async run(context) {
    const payload = context.payload as any;
    if (payload.type !== 'video.completed') {
      return [];
    }
    return [context.payload.body];
  },
});
