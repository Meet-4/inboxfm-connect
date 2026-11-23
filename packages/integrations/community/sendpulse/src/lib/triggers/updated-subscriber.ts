import {
  createTrigger,
  TriggerStrategy,
} from '@inboxfm-connect/pieces-framework';
import { sendpulseAuth } from '../common/auth';
import { sendpulseApiCall } from '../common/client';
import { mailingListDropdown } from '../common/props';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

function detectChanges(previous: any, current: any): Record<string, { from: any; to: any }> {
  const changes: Record<string, { from: any; to: any }> = {};
  
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  
  for (const key of allKeys) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
      changes[key] = {
        from: previous[key],
        to: current[key],
      };
    }
  }
  
  return changes;
}

export const updatedSubscriberTrigger = createTrigger({
  auth: sendpulseAuth,
  name: 'updated_subscriber',
  displayName: 'Updated Subscriber',
  description: 'Fires when subscriber details change (polling)',
  aiMetadata: {
    description: 'Polls the selected SendPulse mailing list (address book) and fires when an existing subscriber\'s details or variables change between checks. Each event represents one changed contact and includes the previous data, current data, and a diff of the changed fields.',
  },
  type: TriggerStrategy.POLLING,
  props: {
    mailingListId: mailingListDropdown,
  },

  async onEnable(context) {
    await context.store.put('mailing_list_id', String(context.propsValue.mailingListId));
    await context.store.put('last_check', Date.now().toString());
  },

  async onDisable(context) {
    await context.store.delete('mailing_list_id');
    await context.store.delete('last_check');
    await context.store.delete('subscribers_cache');
  },

  async run(context) {
    const mailingListId = await context.store.get('mailing_list_id');
    
    if (!mailingListId) {
      return [];
    }

    try {
      const currentSubscribers = await sendpulseApiCall<any[]>({
        method: HttpMethod.GET,
        auth: context.auth.props,
        resourceUri: `/addressbooks/${mailingListId}/emails`,
      });

      const cachedSubscribers = await context.store.get('subscribers_cache');
      
      if (!cachedSubscribers) {
        await context.store.put('subscribers_cache', JSON.stringify(currentSubscribers));
        return [];
      }

      const previousSubscribers = JSON.parse(cachedSubscribers as string);
      const changes = [];

      for (const current of currentSubscribers) {
        const previous = previousSubscribers.find((p: any) => p.email === current.email);
        
        if (previous) {
          const hasChanges = JSON.stringify(current) !== JSON.stringify(previous);
          
          if (hasChanges) {
            changes.push({
              id: `${current.email}_${Date.now()}`,
              email: current.email,
              mailingListId,
              previousData: previous,
              currentData: current,
              updatedAt: new Date().toISOString(),
              changes: detectChanges(previous, current),
            });
          }
        }
      }

      await context.store.put('subscribers_cache', JSON.stringify(currentSubscribers));
      await context.store.put('last_check', Date.now().toString());

      return changes;
    } catch (error: any) {
      console.error('Error checking for subscriber updates:', error);
      return [];
    }
  },

  async test(context) {
    const mailingListId = String(context.propsValue.mailingListId);

    // Hits the same endpoint run() uses, so a bad token or unreadable
    // address book fails the test instead of silently looking healthy.
    // Real change events cannot exist at test time (they need a prior
    // snapshot to diff against), so an empty result is honest here.
    await sendpulseApiCall<unknown[]>({
      method: HttpMethod.GET,
      auth: context.auth.props,
      resourceUri: `/addressbooks/${mailingListId}/emails`,
    });

    return [];
  },

  sampleData: {
    id: 'updated-user@example.com_1234567890',
    email: 'updated-user@example.com',
    mailingListId: '123456',
    previousData: {
      email: 'updated-user@example.com',
      variables: { phone: '+1234567890', name: 'John' },
    },
    currentData: {
      email: 'updated-user@example.com',
      variables: { phone: '+0987654321', name: 'John Updated' },
    },
    updatedAt: '2023-06-01T12:30:00.000Z',
    changes: {
      'variables.phone': {
        from: '+1234567890',
        to: '+0987654321',
      },
      'variables.name': {
        from: 'John',
        to: 'John Updated',
      },
    },
  },
});
