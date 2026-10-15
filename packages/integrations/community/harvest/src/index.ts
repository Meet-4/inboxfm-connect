
    import { createPiece, PieceAuth, OAuth2PropertyValue, Property } from "@inboxfm-connect/pieces-framework";
    import { OAuth2GrantType, PieceCategory } from '@inboxfm-connect/pieces-framework';
    import { getInvoices } from './lib/actions/get-invoices';
    import { getProjects } from './lib/actions/get-projects';
    import { getTasks } from './lib/actions/get-tasks';
    import { getClients } from './lib/actions/get-clients';
    import { getEstimates } from './lib/actions/get-estimates';
    import { getExpenses } from './lib/actions/get-expenses';
    import { getTime_entries } from './lib/actions/get-time_entries';
    import { getRoles } from './lib/actions/get-roles';
    import { getUsers } from './lib/actions/get-users';
    import { reportsUninvoiced } from './lib/actions/reports-uninvoiced';
    import { createCustomApiCallAction } from '@inboxfm-connect/pieces-common';

    export const harvestAuth = PieceAuth.OAuth2({
      required: true,
      grantType: OAuth2GrantType.AUTHORIZATION_CODE,
      authUrl: 'https://id.getharvest.com/oauth2/authorize',
      tokenUrl: `https://id.getharvest.com/api/v2/oauth2/token`,
      scope: ['harvest:all'],
      props: {
        accountId: Property.ShortText({
          displayName: 'Harvest Account ID',
          description:
            'The numeric ID of the Harvest account to access. Harvest requires it in the Harvest-Account-Id header on every API request. You can list the account IDs your token can access at https://id.getharvest.com/api/v2/accounts (only the Authorization header is needed), or find it in the Developers section of Harvest ID (https://id.getharvest.com/developers).',
          required: true,
        }),
      },
    });

    export const harvest = createPiece({
      displayName: "Harvest",
      auth: harvestAuth,
      minimumSupportedRelease: '0.36.1',
      logoUrl: "https://cdn.activepieces.com/pieces/harvest.png",
      categories:[PieceCategory.PRODUCTIVITY],
      description:'Time Tracking Software with Invoicing',
      authors: ["D-Rowe-FS"],
      actions: [getClients, getEstimates, getExpenses, getInvoices, getProjects, getRoles, getTasks, getTime_entries, getUsers,
         reportsUninvoiced,
         createCustomApiCallAction({
          baseUrl: () => `https://api.harvestapp.com/v2/`,
          auth: harvestAuth,
          authMapping: async (auth) => ({
            Authorization: `Bearer ${(auth as OAuth2PropertyValue).access_token}`,
            'Harvest-Account-Id': String(
              (auth as OAuth2PropertyValue).props?.['accountId'] ?? ''
            ),
          }),
            }),
      ],
      triggers: [],
    });
    
