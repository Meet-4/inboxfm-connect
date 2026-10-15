import { DynamicPropsValue, OAuth2PropertyValue } from '@inboxfm-connect/pieces-framework';
import {
  HttpMethod,
  HttpMessageBody,
  HttpResponse,
  httpClient,
  AuthenticationType,
  getAccessTokenOrThrow,
} from '@inboxfm-connect/pieces-common';

export async function callHarvestApi<T extends HttpMessageBody = any>(
  method: HttpMethod,
  apiUrl: string,
  auth: OAuth2PropertyValue,
  queryParams: any | undefined = undefined,
  body: any | undefined = undefined,
  headers: any | undefined = undefined
): Promise<HttpResponse<T>> {
  // Harvest requires both the bearer token and the numeric account ID
  // (in the Harvest-Account-Id header) on every API request.
  // https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/
  const accountId = auth.props?.['accountId'] as string | undefined;

  return await httpClient.sendRequest<T>({
    method: method,
    url: `https://api.harvestapp.com/v2/${apiUrl}`,
    authentication: {
      type: AuthenticationType.BEARER_TOKEN,
      token: getAccessTokenOrThrow(auth),
    },
    headers: {
      ...(accountId ? { 'Harvest-Account-Id': accountId } : {}),
      ...headers,
    },
    body,
    queryParams,
  });
}

//Remove null/undefined values and create an array to be used for queryparams
export function filterDynamicFields(dynamicFields: DynamicPropsValue): { [key: string]: string } {
  const fields: { [key: string]: string } = {};

  const props = Object.entries(dynamicFields);
  for (const [propertyKey, propertyValue] of props) {
    if (
      propertyValue !== null &&
      propertyValue !== undefined &&
      propertyValue !== '' &&
      !(typeof propertyValue === 'string' && propertyValue.trim() === '')
    ) {
      fields[propertyKey] = propertyValue;
    }
  }

  return fields;
}
