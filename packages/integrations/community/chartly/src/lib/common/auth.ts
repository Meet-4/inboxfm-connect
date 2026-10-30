import { PieceAuth } from "@inboxfm-connect/pieces-framework";

export const chartlyAuth = PieceAuth.SecretText({
    displayName: 'API Key',
    required: true,
    description: `
    1. Visit chartly.dev to generate your free trial API key
    2. Create an account to manage your API keys and access higher limits
    3. Find your keys in your dashboard anytime
    4. API keys look like: trial_abc123...xyz789`,
    validate: async ({ auth }) => {
        try {
            // /v1/status is a public health endpoint — it answers 200 with no API
            // key at all, so validating against it accepted every key. /v1/chart is
            // key-gated: it returns 401 for a missing or invalid key (the API's
            // OpenAPI spec documents a 401 response for GET /v1/chart).
            const response = await fetch('https://api.chartly.dev/v1/chart', {
                method: 'GET',
                headers: {
                    'X-Api-Key': auth,
                },
            });

            if (response.status === 401 || response.status === 403) {
                return {
                    valid: false,
                    error: `Invalid API key: ${response.status} ${response.statusText}`,
                };
            }

            if (!response.ok) {
                return {
                    valid: false,
                    error: `Chartly API error: ${response.status} ${response.statusText}`,
                };
            }

            return {
                valid: true,
            };
        } catch (error) {
            return {
                valid: false,
                error: `Connection error: ${(error as Error).message}`,
            };
        }
    },
});

