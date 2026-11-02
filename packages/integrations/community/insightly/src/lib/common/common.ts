import { httpClient, HttpMethod, AuthenticationType } from '@inboxfm-connect/pieces-common';
import { AppConnectionValueForAuthProperty, PieceAuth } from '@inboxfm-connect/pieces-framework';

export const insightlyAuth = PieceAuth.SecretText({
  displayName: 'API Key',
  description: 'Enter your Insightly API key. You can find this in your Insightly account under User Settings > API Keys.',
  required: true,
});

export const INSIGHTLY_OBJECTS = [
  'Contacts',
  'Leads', 
  'Opportunities',
  'Organisations',
  'Projects',
  'Tasks',
  'Events',
  'Notes',
  'Products',
  'Quotations'
];

export async function makeInsightlyRequest(
  auth: AppConnectionValueForAuthProperty<typeof insightlyAuth>, 
  endpoint: string, 
  pod = 'na1',
  method: HttpMethod = HttpMethod.GET,
  body?: any
) {
  const baseUrl = `https://api.${pod}.insightly.com/v3.1`;
  const url = `${baseUrl}${endpoint}`;

  const requestConfig: any = {
    method,
    url,
    authentication: {
      type: AuthenticationType.BASIC,
      username: auth.secret_text,
      password: '',
    },
  };

  if (body && (method === HttpMethod.POST || method === HttpMethod.PUT)) {
    requestConfig.headers = {
      'Content-Type': 'application/json',
    };
    requestConfig.body = body;
  }

  return await httpClient.sendRequest(requestConfig);
}

// Insightly v3.1 returns paginated recordsets (100 records per response by
// default, 500 maximum) and pages via the top/skip query parameters. The
// record dropdowns issued a single top=100 request, silently dropping every
// record past the first 100, so walk skip pages with the documented maximum
// page size and a bounded budget.
// https://api.insightly.com/v3.1/Help
const INSIGHTLY_PAGE_SIZE = 500;
const INSIGHTLY_MAX_PAGES = 10;

export async function listInsightlyRecordOptions(
  auth: AppConnectionValueForAuthProperty<typeof insightlyAuth>,
  objectName: string,
  pod: string
): Promise<{
  options: { label: string; value: string | number }[];
  truncated: boolean;
}> {
  const records: Record<string, any>[] = [];
  let truncated = false;
  let skip = 0;
  let pages = 0;

  while (pages < INSIGHTLY_MAX_PAGES) {
    const response = await makeInsightlyRequest(
      auth,
      `/${objectName}?top=${INSIGHTLY_PAGE_SIZE}&skip=${skip}&brief=true`,
      pod
    );

    const page: Record<string, any>[] = Array.isArray(response.body)
      ? response.body
      : [];
    if (page.length === 0) {
      break;
    }
    records.push(...page);

    if (page.length < INSIGHTLY_PAGE_SIZE) {
      break;
    }
    pages++;
    if (pages >= INSIGHTLY_MAX_PAGES) {
      truncated = true;
      break;
    }
    skip += page.length;
  }

  const options = records.map((record: Record<string, any>) => {
    const idKey = Object.keys(record).find(key => key.endsWith('_ID'));
    const recordId = idKey ? record[idKey] : 'Unknown ID';

    const nameKey = Object.keys(record).find(
      key =>
        key.endsWith('_NAME') || key === 'TITLE' || key === 'FIRST_NAME'
    );
    let recordName = nameKey ? record[nameKey] : `Record ${recordId}`;

    if (objectName === 'Contacts' || objectName === 'Leads') {
      recordName = `${record['FIRST_NAME'] || ''} ${record['LAST_NAME'] || ''}`.trim();
    }

    return {
      label: `${recordName} (ID: ${recordId})`,
      value: recordId as string | number,
    };
  });

  return { options, truncated };
}
