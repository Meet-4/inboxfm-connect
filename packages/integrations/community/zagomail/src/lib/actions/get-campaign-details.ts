import { zagomailAuth } from '../auth';
import { createAction } from '@inboxfm-connect/pieces-framework';
import { zagoMailApiService } from '../common/request';
import { campaignUid } from '../common/props';

export const getCampaignDetails = createAction({
  auth: zagomailAuth,
  name: 'getCampaignDetails',
  displayName: 'Get Campaign',
  description: 'Gets the details of a campaign.\n\nDEPRECATED (Nov 2026 liveness census): The API hosts api.zagomail.com and app.zagomail.com no longer resolve (NXDOMAIN confirmed on multiple resolvers), so this action cannot reach its API.',
  audience: 'both',
  aiMetadata: { description: 'Retrieves the details of a single Zagomail email campaign identified by its campaign UID. Use to inspect a campaign configuration or status. Read-only and idempotent.', idempotent: true },
  props: {
    campaignUid: campaignUid,
  },
  async run({propsValue, auth}) {
    const campaignUid = propsValue.campaignUid;

    return await zagoMailApiService.getCampaignDetails(auth.secret_text, campaignUid)
  },
});
