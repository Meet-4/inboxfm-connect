import {
    AppConnectionValueForAuthProperty,
    PieceAuth,
} from '@inboxfm-connect/pieces-framework';
import { httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';

const ZENDESK_SELL_API_URL = 'https://api.getbase.com';

const markdownDescription = `
    To get a Personal Access Token:
    1. Log in to your Zendesk Sell account.
    2. Go to **Settings > Integrations > OAuth** and open the **Access Tokens** tab.
    3. Click **+ Add User Token** and copy the generated token.

    The Sell API only accepts this token as \`Authorization: Bearer <token>\`. A
    Zendesk Support API token (sent with your email address) does not work here.
    `;

export const zendeskSellAuth = PieceAuth.SecretText({
    displayName: 'Personal Access Token',
    description: markdownDescription,
    required: true,
    validate: async ({ auth }) => {
        try {
            await httpClient.sendRequest({
                method: HttpMethod.GET,
                url: `${ZENDESK_SELL_API_URL}/v2/users/self`,
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${auth}`,
                },
            });
            return {
                valid: true,
            };
        } catch (e) {
            return {
                valid: false,
                error: 'Invalid Personal Access Token.',
            };
        }
    },
});

export type ZendeskSellAuth = AppConnectionValueForAuthProperty<
    typeof zendeskSellAuth
>;
