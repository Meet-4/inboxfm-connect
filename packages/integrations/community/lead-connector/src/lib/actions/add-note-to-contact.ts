import { createAction, OAuth2PropertyValue, Property } from '@inboxfm-connect/pieces-framework';
import {
  addNoteToContact,
  getContacts,
  getUsers,
  getAllContacts,
} from '../common';
import { leadConnectorAuth } from '../..';

export const addNoteToContactAction = createAction({
  auth: leadConnectorAuth,
  name: 'add_note_to_contact',
  displayName: 'Add Note to Contact',
  description: 'Add a new note to a contact.',
  audience: 'both',
  aiMetadata: { description: 'Appends a note (free-text body attributed to a user) to an existing GoHighLevel/LeadConnector contact. Requires the contact ID and the authoring user ID. Not idempotent — each call appends a new note even if the text is identical.', idempotent: false },
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
    note: Property.ShortText({
      displayName: 'Note',
      required: true,
    }),
    user: Property.Dropdown({
  auth: leadConnectorAuth,
      displayName: 'User',
      required: true,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth)
          return {
            disabled: true,
            options: [],
          };

        const users = await getUsers(auth as OAuth2PropertyValue);
        return {
          options: users.map((user: any) => {
            return {
              label: `${user.firstName} ${user.lastName}`,
              value: user.id,
            };
          }),
        };
      },
    }),
  },

  async run({ auth, propsValue }) {
    const { contact, note, user } = propsValue;

    return await addNoteToContact(auth.access_token, contact, {
      body: note,
      userId: user,
    });
  },
});

