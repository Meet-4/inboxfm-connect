import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod, httpClient } from '@inboxfm-connect/pieces-common';
import { personalAiAuth } from '../../auth';
import { BASE_URL } from '../../../index';

export const getDocument = createAction({
  auth:personalAiAuth,
  name: 'get_document',
  displayName: 'Get Document',
  description: 'Retrieve a document or a list of documents from AI assistant.',
  audience: 'both',
  aiMetadata: { description: 'Fetch documents from a Personal AI persona, optionally narrowed to a single document by its name. Leave the document name blank to list the most recent documents. Read-only and idempotent.', idempotent: true },
  // category: 'Documents',
  props: {
    documentName: Property.ShortText({
      displayName: 'Document Name',
      description:
        'The name (title) of the document to retrieve. Leave blank to list documents.',
      required: false,
    }),
    domainName: Property.ShortText({
      displayName: 'Domain Name',
      description: 'The domain identifier for the AI profile',
      required: false,
    }),
    size: Property.Number({
      displayName: 'Size',
      description: 'The number of documents to return',
      required: false,
      defaultValue: 5,
    }),
  },
  async run(context) {
    const { auth, propsValue: { documentName, domainName, size } } = context;

    const response = await httpClient.sendRequest({
      method: HttpMethod.POST,
      url: `${BASE_URL}/v1/document`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': auth.secret_text,
      },
      queryParams: {
        size: (size ?? 5).toString(),
      },
      body: {
        ...(documentName && { Text: documentName }),
        ...(domainName && { DomainName: domainName }),
      },
    });

    return response.body;
  },
});
