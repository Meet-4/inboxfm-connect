import { Property, TriggerStrategy, createTrigger } from "@inboxfm-connect/pieces-framework";
import { emailOctopusAuth } from "../common/auth";
import { emailOctopusProps } from "../common/props";
import { MarkdownVariant } from '@inboxfm-connect/pieces-framework';

interface EmailOctopusEvent {
  type: string;
  id: string;
  contact_email_address: string;
  campaign_id?: string;
  list_id?: string;
  contact_id?: string;
  occurred_at?: string;
}

export const emailBounced = createTrigger({
    auth: emailOctopusAuth,
    name: 'email_bounced',
    displayName: 'Email Bounced',
    description: 'Triggers when an email to a recipient bounces from a specific campaign.',
    aiMetadata: {
      description: 'Fires when an EmailOctopus campaign email bounces for a recipient (a contact.bounced webhook event), representing a delivery failure. Can be scoped to a single campaign id, or left unfiltered to catch bounces across all campaigns.',
    },
    props: {
        campaign_id: emailOctopusProps.campaignId(),
            liveMarkdown: Property.MarkDown({
              value: `
              **Live URL:**
        \`\`\`text
        {{webhookUrl}}
        \`\`\``,
              variant: MarkdownVariant.BORDERLESS,
            }),
        instructions: Property.MarkDown({
            value: `
            **Manual Setup Required**

            1. Go to your EmailOctopus Dashboard.
            2. Navigate to **API & Integrations**, then select the **Webhooks** tab.
            3. Click **Add webhook**.
            4. Paste the Above URL below into the **URL** field:
            5. Select the **Email bounced** event.
            6. Click **Add webhook**.
            `,
        }),
    },
    type: TriggerStrategy.WEBHOOK,
    sampleData: {
        "id": "42636763-73f9-463e-af8b-3f720bb3d889",
        "type": "contact.bounced",
        "list_id": "fa482fa2-5ac4-11ed-9f7a-67da1c836cf8",
        "contact_id": "e3ab8c80-5f65-11ed-835e-030e4bb63150",
        "occurred_at": "2022-11-18T15:20:23+00:00",
        "contact_email_address": "user@example.com",
        "contact_status": "BOUNCED",
        "campaign_id": "12345678-1234-1234-1234-123456789abc"
    },

    async onEnable(context) { return },
    async onDisable(context) { return },

    async run(context) {
        // EmailOctopus delivers a JSON array of events (up to 1000 per request).
        // Docs: https://help.emailoctopus.com/article/314-webhooks
        const events = context.payload.body;
        const campaignIdFilter = context.propsValue.campaign_id;

        if (Array.isArray(events)) {
            return events.filter(
                (event: EmailOctopusEvent) =>
                    event.type === 'contact.bounced' &&
                    (!campaignIdFilter || event.campaign_id === campaignIdFilter)
            );
        }

        if (
            (events as EmailOctopusEvent)?.type === 'contact.bounced' &&
            (!campaignIdFilter || (events as EmailOctopusEvent).campaign_id === campaignIdFilter)
        ) {
            return [events];
        }

        return [];
    },
});
