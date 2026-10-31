import {
	httpClient,
	HttpMethod,
	AuthenticationType,
} from '@inboxfm-connect/pieces-common';
import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { BASE_URL } from './client';

async function testEndpoint(auth: string): Promise<boolean> {
	try {
		await httpClient.sendRequest({
			method: HttpMethod.GET,
			// GET api/cube (list cubes) is the live, documented Web API
			// route the new-csv-cube trigger already uses; the old
			// api/user/info route answers 404 for every key.
			url: `${BASE_URL}api/cube`,
			authentication: {
				type: AuthenticationType.BEARER_TOKEN,
				token: auth,
			},
		});
		return true;
	} catch {
		return false;
	}
}

export const seekTableAuth = PieceAuth.SecretText({
	displayName: 'API Key',
	description: 'Get your API key from Manage Account → Get API Key dialog in your SeekTable dashboard.',
	required: true,
	validate: async ({ auth }) => {
		const isValid = await testEndpoint(auth);
		if (isValid) {
			return { valid: true };
		}

		return {
			valid: false,
			error: 'Invalid API key',
		};
	},
});
