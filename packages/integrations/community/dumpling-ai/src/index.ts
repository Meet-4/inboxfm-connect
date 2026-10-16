import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import {
	webSearch,
	searchNews,
	generateImage,
	scrapeWebsite,
	crawlWebsite,
	extractDocument,
} from './lib/actions';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import {
	AuthenticationType,
	createCustomApiCallAction,
	httpClient,
	HttpMethod,
} from '@inboxfm-connect/pieces-common';
import { dumplingAuth } from './lib/auth';

export const dumplingAi = createPiece({
	displayName: 'Dumpling AI',
	description:'Transform unstructured website content into clean, AI-ready data',
	auth: dumplingAuth,
	minimumSupportedRelease: '0.36.1',
	logoUrl: 'https://cdn.activepieces.com/pieces/dumpling-ai.png',
	authors: ['neo773'],
	categories: [PieceCategory.ARTIFICIAL_INTELLIGENCE, PieceCategory.PRODUCTIVITY],
	actions: [
		webSearch,
		searchNews,
		generateImage,
		scrapeWebsite,
		crawlWebsite,
		extractDocument,
		createCustomApiCallAction({
			baseUrl: () => 'https://app.dumplingai.com/api/v1',
			auth: dumplingAuth,
			authMapping: async (auth) => ({
				Authorization: `Bearer ${auth.secret_text}`,
			}),
		}),
	],
	triggers: [],
});

