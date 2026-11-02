import { createAction, OAuth2PropertyValue, Property } from '@inboxfm-connect/pieces-framework';
import { addContactToCampaign, getCampaigns, getContacts ,
  getAllContacts,
} from '../common';
import { leadConnectorAuth } from '../..';

export const addContactToCampaignAction = createAction({
  auth: leadConnectorAuth,
  name: 'add_contact_to_campaign',
  displayName: 'Add Contact to Campaign',
  description: 'Add an existing contact to a campaign.',
  audience: 'both',
  aiMetadata: { description: 'Enrolls an existing GoHighLevel/LeadConnector contact into a marketing campaign by contact ID and campaign ID. Use to start a campaign sequence for a known contact. Not idempotent — each call re-enrolls the contact.', idempotent: false },
  props: {
    contact: Property.Dropdown({
  auth: leadConnectorAuth,
      displayName: 'Contact',
      description: 'The contact to use.',
      required: true,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth)
          return {
            disabled: true,
            options: [],
          };

        const contacts = await getAllContacts(auth as OAuth2PropertyValue);
        const options = contacts.items.map((contact) => {
          return {
            label: contact.contactName,
            value: contact.id,
          };
        });
        if (contacts.truncated) {
          options.push({
            label: '⚠️ Could not load all contacts (partial list)',
            value: '__truncated_notice__',
          });
        }
        return {
          options,
        };
      },
    }),
    campaign: Property.Dropdown({
  auth: leadConnectorAuth,
      displayName: 'Campaign',
      required: true,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            options: [],
          };
        }

        const campaigns = await getCampaigns(auth as OAuth2PropertyValue);
        return {
          options: campaigns.map((campaign: any) => {
            return {
              label: campaign.name,
              value: campaign.id,
            };
          }),
        };
      },
    }),
  },

  async run({ auth, propsValue }) {
    const { contact, campaign } = propsValue;

    return await addContactToCampaign(auth.access_token, contact, campaign);
  },
});

