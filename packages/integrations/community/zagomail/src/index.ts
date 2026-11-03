import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { addedSubscriber } from './lib/triggers/added-subscriber';
import { unsubscribedSubscriber } from './lib/triggers/unsubscribed-subscriber';
import { taggedSubscriber } from './lib/triggers/tagged-subscriber';
import { createSubscriber } from './lib/actions/create-subscriber';
import { tagSubscriber } from './lib/actions/tag-subscriber';
import { updateSubscriber } from './lib/actions/update-subscriber';
import { searchSubscriberByEmail } from './lib/actions/search-subscriber-by-email';
import { getSubscriberDetails } from './lib/actions/get-subscriber-details';
import { getCampaignDetails } from './lib/actions/get-campaign-details';
import { unsubscribeSubscriber } from './lib/actions/unsubscribe-subscriber';
import { zagoMailApiService } from './lib/common/request';
import { zagomailAuth } from './lib/auth';

export const zagomail = createPiece({
	displayName: 'Zagomail',
	description: 'All-in-one email marketing and automation platform\n\nDEPRECATED (Nov 2026 liveness census): The API hosts api.zagomail.com and app.zagomail.com no longer resolve (NXDOMAIN confirmed on multiple resolvers), so this action cannot reach its API.',
	logoUrl: 'https://cdn.activepieces.com/pieces/zagomail.png',
	authors: ['gs03dev'],
	auth: zagomailAuth,
	actions: [
		createSubscriber,
		tagSubscriber,
		updateSubscriber,

		searchSubscriberByEmail,

		getSubscriberDetails,
		getCampaignDetails,
		unsubscribeSubscriber,
	],
	triggers: [addedSubscriber, unsubscribedSubscriber, taggedSubscriber],
	categories: [PieceCategory.MARKETING],
});
