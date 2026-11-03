import { createTrigger, TriggerStrategy } from '@inboxfm-connect/pieces-framework';
import { on } from 'events';
import { oncehubAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
export const bookingCompleted = createTrigger({
  auth: oncehubAuth,
  name: 'bookingCompleted',
  displayName: 'Booking Completed',
  description: 'Triggered when booking end time has passed.',
  aiMetadata: {
    description:
      'Fires when a booking has finished, i.e. its scheduled end time has passed in OnceHub. Use to run follow-up actions after a meeting concludes.',
  },
  props: {},
  sampleData: {
    id: 'EVNT-KN56U3YL7C',
    object: 'event',
    creation_time: '2026-10-15T09:49:12Z',
    type: 'booking.completed',
    api_version: 'v2',
    data: {
      object: 'booking',
      id: 'BKNG-J4FR05BKEWEX',
      tracking_id: 'D36E0002',
      subject: 'Live demo',
      status: 'complete',
      in_trash: false,
      creation_time: '2026-10-15T09:48:48Z',
      starting_time: '2026-10-15T04:30:00Z',
      customer_timezone: 'America/New_York',
      last_updated_time: '2026-10-15T09:48:48Z',
      duration_minutes: 60,
      virtual_conferencing: {
        join_url: 'https://meet.google.com/izv-daci-fyi',
      },
      location_description: '123 Office Street',
      rescheduled_booking_id: 'BKNG-J4FR05BKEWEX',
      cancel_reschedule_information: null,
      attendees: [
        'andrea.hartie@example.com',
      ],
      form_submission: {
        name: 'Carrie Customer',
        email: 'carrie.customer@gmail.com',
        phone: null,
        mobile_phone: '1-2025550195',
        note: 'I want to discuss whether your product can work for our office.',
        company: null,
        guests: [
          '',
        ],
        custom_fields: [
          {
            name: 'Title',
            value: 'Executive Assistant',
          },
        ],
      },
      ics_url: 'https://oncehub.com/api/bookings/ics/62ad3bdd-a09f-dfbdffbef389-axs01j',
      booking_calendar: 'BKC-03WJV0R52Z',
      cancel_url: 'https://oncehub.com/m/BKNG-3KM0HY2BF9SL/cancel',
      reschedule_url: 'https://oncehub.com/m/BKNG-3KM0HY2BF9SL',
      custom_fields: [
        {
          name: 'discussion_points',
          value: 'Need support on new product',
        },
      ],
      owner: 'USR-FSD423423',
      cancel_reschedule_url: 'https://oncehub.com/m/BKNG-3KM0HY2BF9SL',
    },
  },
  type: TriggerStrategy.WEBHOOK,
  async onEnable(context) {
    const api_key = context.auth.secret_text;
    const { webhookUrl } = context;

    const response = await makeRequest(api_key, HttpMethod.POST, '/webhooks', {
      url: webhookUrl,
      name: `Booking Completed Webhook - ${new Date().getTime()}`,
      events: ['booking.completed'],
    });

    await context.store.put('webhookId_bookingCompleted', response.id);
  },
  async onDisable(context) {
    const api_key = context.auth.secret_text;
    const webhookId = await context.store.get<string>(
      'webhookId_bookingCompleted'
    );

    if (webhookId) {
      await makeRequest(api_key, HttpMethod.DELETE, `/webhooks/${webhookId}`);
    }

    await context.store.delete('webhookId_bookingCompleted');
  },
  async run(context) {
    return [context.payload.body];
  },
});
