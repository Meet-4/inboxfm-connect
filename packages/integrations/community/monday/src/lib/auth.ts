import { PieceAuth } from '@inboxfm-connect/pieces-framework';
import { mondayClient } from './common/client';

const markdown = `
1.Log into your monday.com account.\n
2.Click on your avatar/profile picture in the top right corner.\n
3.Select **Administration** (this requires you to have admin permissions).\n
4.Go to the **API** section.\n
5.Copy your personal token`;

export const mondayAuth = PieceAuth.SecretText({
  displayName: 'API v2 Token',
  description: markdown,
  required: true,
  validate: async ({ auth }) => {
    try {
      // monday-sdk-js resolves GraphQL error bodies without throwing, so the
      // response has to be checked, not just awaited
      const client = new mondayClient(auth);
      const res = await client.getCurrentUser();
      if (res?.data?.me?.id != null) {
        return { valid: true };
      }
      return {
        valid: false,
        error:
          'Invalid monday.com API v2 Token. Check your personal token under monday.com > avatar > Administrators > API.',
      };
    } catch (e) {
      return {
        valid: false,
        error:
          'Could not reach monday.com to validate your API v2 Token. Please try again.',
      };
    }
  },
});
