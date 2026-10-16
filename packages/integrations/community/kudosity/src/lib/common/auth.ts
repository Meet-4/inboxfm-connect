import { PieceAuth } from '@inboxfm-connect/pieces-framework';

export const kudosityAuth = PieceAuth.CustomAuth({
  description: `
Connect your Kudosity account.

To get your credentials:
1. Log in to your Kudosity dashboard.
2. Go to **Developers > API Settings** (or **Settings > API Settings**).
3. Copy your **API Key** — sent as the \`x-api-key\` header for V2 API calls (send SMS, get SMS info, webhooks).
4. Copy your **API Secret** — combined with the API Key for HTTP Basic authentication on V1 API calls (contact list actions, cancel SMS, format number). See https://developers.kudosity.com/docs/agent-skills ("V1 — api.transmitsms.com — HTTP Basic, using your key and secret").
`,
  required: true,
  props: {
    apiKey: PieceAuth.SecretText({
      displayName: 'API Key',
      description: 'Kudosity API Key',
      required: true,
    }),
    apiSecret: PieceAuth.SecretText({
      displayName: 'API Secret',
      description:
        'Kudosity API Secret — paired with the API Key for V1 API Basic authentication',
      required: true,
    }),
  },
});
