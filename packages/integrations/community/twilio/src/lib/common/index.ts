import {
  Property,
  BasicAuthPropertyValue,
} from '@inboxfm-connect/pieces-framework';
import {
  HttpMethod,
  HttpMessageBody,
  HttpResponse,
  httpClient,
  AuthenticationType,
} from '@inboxfm-connect/pieces-common';
import { twilioAuth } from '../..';

export const twilioCommon = {
  phone_number: Property.Dropdown({
    auth: twilioAuth,
    description: 'The phone number to send the message from',
    displayName: 'From',
    required: true,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return {
          disabled: true,
          placeholder: 'connect your account first',
          options: [],
        };
      }

      const basicAuthProperty = auth;
      // Twilio list resources default to PageSize=50 (max 1000) and expose a
      // next_page_uri cursor for further pages.
      // https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource
      const MAX_PAGES = 10;
      const numbers: { phone_number: string; friendly_name: string }[] = [];
      let nextPage: string | undefined = 'IncomingPhoneNumbers.json?PageSize=1000';
      let pages = 0;

      while (nextPage && pages < MAX_PAGES) {
        pages++;
        const response: HttpResponse<{
          incoming_phone_numbers: {
            phone_number: string;
            friendly_name: string;
          }[];
          next_page_uri: string | null;
        }> = await callTwilioApi<{
          incoming_phone_numbers: {
            phone_number: string;
            friendly_name: string;
          }[];
          next_page_uri: string | null;
        }>(HttpMethod.GET, nextPage, {
          account_sid: basicAuthProperty.username,
          auth_token: basicAuthProperty.password,
        });
        numbers.push(...(response.body.incoming_phone_numbers ?? []));
        nextPage = response.body.next_page_uri
          ? `https://api.twilio.com${response.body.next_page_uri}`
          : undefined;
      }

      const truncated = Boolean(nextPage);
      const options = numbers.map((number) => ({
        value: number.phone_number,
        label: number.friendly_name,
      }));
      if (truncated) {
        options.push({
          label: '⚠️ Could not load all phone numbers (partial list)',
          value: '__truncated_notice__',
        });
      }

      return {
        disabled: false,
        options,
      };
    },
  }),
};

export const callTwilioApi = async <T extends HttpMessageBody>(
  method: HttpMethod,
  path: string,
  auth: { account_sid: string; auth_token: string },
  body?: any
): Promise<HttpResponse<T>> => {
  const url = path.startsWith('http')
    ? path
    : `https://api.twilio.com/2010-04-01/Accounts/${auth.account_sid}/${path}`;
  return await httpClient.sendRequest<T>({
    method,
    url,
    authentication: {
      type: AuthenticationType.BASIC,
      username: auth.account_sid,
      password: auth.auth_token,
    },
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });
};
