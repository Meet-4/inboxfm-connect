import { AppConnectionValueForAuthProperty, OAuth2PropertyValue, createTrigger } from '@inboxfm-connect/pieces-framework';
import { TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import {
  DedupeStrategy,
  Polling,
  pollingHelper,
} from '@inboxfm-connect/pieces-common';
import { leadConnectorAuth } from '../..';
import { getContacts } from '../common';

const polling: Polling<AppConnectionValueForAuthProperty<typeof leadConnectorAuth>, unknown> = {
  strategy: DedupeStrategy.LAST_ITEM,
  items: async ({ auth, lastItemId }) => {
    const currentValues =
      (await getContacts(auth, {
        startAfterId: lastItemId as string,
        sortOrder: 'asc',
      })) ?? [];

    return currentValues.map((contact) => {
      return {
        id: contact.id,
        data: contact,
      };
    });
  },
};

export const newContact = createTrigger({
  auth: leadConnectorAuth,
  name: 'new_contact',
  displayName: 'New Contact',
  description: 'Trigger when a new contact is added.',
  aiMetadata: {
    description: 'Fires when a new contact is added to the GoHighLevel/LeadConnector location, polling for contacts not seen before. Represents the newly created contact; does not fire on updates to existing contacts.',
  },
  props: {},
  type: TriggerStrategy.POLLING,
  sampleData: {
    id: 'DWQ45t2IPVxi9LDu1wBl',
    locationId: 'FFIlZv9yV8nW4b05UR3l',
    firstName: 'Jane',
    lastName: 'Doe',
    contactName: 'Jane Doe',
    email: 'jane.doe@example.com',
    phone: '+15550100',
    companyName: 'Acme Corp',
    website: 'https://www.acme.com',
    tags: ["newsletter"],
    source: 'API',
    country: 'US',
    city: 'Austin',
    state: 'TX',
    address: '100 Main St',
    postalCode: '78701',
    timezone: 'America/Chicago',
    dnd: false,
    type: 'lead',
    customField: [],
    dateAdded: '2026-10-15T10:30:00.000Z',
    dateUpdated: '2026-10-15T10:35:00.000Z',
  },

  onEnable: async (context) => {
    await pollingHelper.onEnable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  onDisable: async (context) => {
    await pollingHelper.onDisable(polling, {
      auth: context.auth,
      store: context.store,
      propsValue: context.propsValue,
    });
  },
  run: async (context) => {
    return await pollingHelper.poll(polling, context);
  },
  test: async (context) => {
    return await pollingHelper.test(polling, context);
  },
});

