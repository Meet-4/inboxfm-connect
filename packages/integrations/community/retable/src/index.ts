import { createCustomApiCallAction, httpClient, HttpMethod } from '@inboxfm-connect/pieces-common';
import { createPiece, PieceAuth } from '@inboxfm-connect/pieces-framework';
import { PieceCategory } from '@inboxfm-connect/pieces-framework';
import { retableCreateProjectAction } from './lib/actions/create-project';
import { retableCreateWorkspaceAction } from './lib/actions/create-workspace';
import { retableGetAllProjectsAction } from './lib/actions/get-all-projects';
import { retableGetAllRetablesAction } from './lib/actions/get-all-retables';
import { retableGetAllWorkspacesAction } from './lib/actions/get-all-workspaces';
import { retableCreateRecordAction } from './lib/actions/insert-record';
import { retableCommon } from './lib/common';
const markdown = `
To obtain your API key, follow these steps:

1. Go to Account Overview by clicking your profile-pic (top-right).
2. Go to API section and enable API key.
3. Copy API key.`;

export const retableAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  required: true,
  description: markdown,
  validate: async ({ auth }) => {
    try {
      // The public workspaces endpoint answers 404 for an unknown key and
      // 200 with the workspace list for a valid one (the same route the
      // piece's workspace dropdown already uses).
      await httpClient.sendRequest({
        method: HttpMethod.GET,
        url: 'https://api.retable.io/v1/public/workspace',
        headers: {
          ApiKey: auth,
        },
      });
      return {
        valid: true,
      };
    } catch {
      return {
        valid: false,
        error: 'Invalid API Key',
      };
    }
  },
});
export const retable = createPiece({
  displayName: 'Retable',
  description: 'Turn your spreadsheets into smart database apps',

  auth: retableAuth,
  minimumSupportedRelease: '0.30.0',
  logoUrl: 'https://cdn.activepieces.com/pieces/retable.png',
  categories: [PieceCategory.PRODUCTIVITY],
  authors: ["kishanprmr","MoShizzle","abuaboud"],
  actions: [
    retableCreateRecordAction,
    retableGetAllWorkspacesAction,
    retableGetAllProjectsAction,
    retableGetAllRetablesAction,
    retableCreateWorkspaceAction,
    retableCreateProjectAction,
    createCustomApiCallAction({
      baseUrl: () => retableCommon.baseUrl,
      auth: retableAuth,
      authMapping: async (auth) => ({
        ApiKey: auth.secret_text,
      }), 
    }),
  ],
  triggers: [],
});
