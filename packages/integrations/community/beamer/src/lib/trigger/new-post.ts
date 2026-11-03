import {
  Property,
  TriggerStrategy,
  createTrigger,
} from '@inboxfm-connect/pieces-framework';

const markdown = `
- Go to the "Integration" section.
- Find and click on the "Webhook" plugin to activate it.
- Add a webhook to that form.
- In the webhook settings, paste this URL: 
  \`{{webhookUrl}}\`
`;

export const newPost = createTrigger({
  name: 'new_post_on_beamer',
  displayName: 'New Beamer Post',
  description: 'Triggers when new post is found in your beamer account',
  aiMetadata: {
    description: 'Fires when a new post is published in the connected Beamer account, delivered via a Beamer webhook integration. Represents a freshly created announcement or changelog entry.',
  },
  props: {
    md: Property.MarkDown({
      value: markdown,
    }),
  },
  type: TriggerStrategy.WEBHOOK,
  sampleData: [
    {
    id: '1234',
    date: '2026-10-15T10:30:00Z',
    published: 'true',
    category: 'New',
    feedbackEnabled: 'true',
    reactionsEnabled: 'true',
    showInWidget: 'true',
    showInStandalone: 'true',
    postUrl: 'https://app.getbeamer.com/beamer/en/how-to-write-engaging-release-notes-',
    language: 'EN',
    title: 'Title of the post',
    contentHtml: '<p class="">Content for this post!</p>\n',
    content: 'Content for this post!',
    linkUrl: 'https://www.getbeamer.com/',
    linkText: 'Click here!',
    },
  ],

  async onEnable(context) {
    // IGNORED
  },
  async onDisable(context) {
    // IGNORED
  },
  async run(context) {
    return [context.payload.body];
  },
});

