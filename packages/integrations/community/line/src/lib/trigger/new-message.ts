import {
  createTrigger,
  PieceAuth,
  Property,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';

const markdown = `
- Create Line bot account from Developer Console
- Go to the "Messaging API" section.
- In the webhook settings, paste this URL: 
  \`{{webhookUrl}}\`
- Publish Activepieces flow first then click "Verify" button
`;

export const newMessage = createTrigger({
  name: 'new-message',
  displayName: 'New Message',
  auth: PieceAuth.None(),
  description: 'Triggers when a new message is received',
  aiMetadata: {
    description: 'Fires when the LINE bot receives an inbound message event from a user via the Messaging API webhook. Each emitted item represents one active message event, carrying the sender details and message content needed to react or reply.',
  },
  props: {
    md: Property.MarkDown({
      value: markdown,
    }),
  },
  type: TriggerStrategy.WEBHOOK,
  sampleData: {
    type: 'message',
    mode: 'active',
    webhookEventId: '01FZ7A8HqM3vBcD2EfGhIjKlMnOpQrStUvW',
    deliveryContext: {
      isRedelivery: false,
    },
    timestamp: 1762000000000,
    source: {
      type: 'user',
      userId: 'U4af4980629a1e3c6e5d7b8c9d0e1f2a3',
    },
    replyToken: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6',
    message: {
      id: '3257080000000001',
      type: 'text',
      text: 'Hello, world!',
    },
  },
  async onEnable(context) {
    // Empty
  },
  async onDisable(context) {
    // Empty
  },
  async run(context) {
    const { events } = context.payload.body as { events: unknown[] };
    if (!events) {
      return [];
    }
    return events.filter(
      (event: any) => event.mode === 'active' && event.type === 'message'
    );
  },
});

