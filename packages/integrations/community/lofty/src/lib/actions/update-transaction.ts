import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { loftyAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { leadIdDropdown, transactionIdDropdown } from '../common/props';

export const updateTransaction = createAction({
  auth: loftyAuth,
  name: 'updateTransaction',
  displayName: 'Update Transaction',
  description: 'Update a transaction for a Lofty lead',
  audience: 'both',
  aiMetadata: {
    description:
      'Updates an existing transaction on a Lofty lead, identified by both the lead id and transaction id, sending only the provided fields (amount, property details, dates, agent, source, note). Use to amend a known deal rather than create one. Idempotent: applying the same field values repeatedly leaves the transaction in the same state.',
    idempotent: true,
  },
  props: {
    leadId: leadIdDropdown,
    transactionId: transactionIdDropdown,
    transactionDate: Property.ShortText({
      displayName: 'Transaction Date',
      description: 'YYYY-MM-DD',
      required: false,
    }),
    amount: Property.Number({
      displayName: 'Amount',
      required: false,
    }),
    transactionType: Property.ShortText({
      displayName: 'Transaction Type',
      description: 'e.g., sale, rent',
      required: false,
    }),
    propertyAddress: Property.ShortText({
      displayName: 'Property Address',
      required: false,
    }),
    propertyCity: Property.ShortText({
      displayName: 'Property City',
      required: false,
    }),
    propertyState: Property.ShortText({
      displayName: 'Property State',
      required: false,
    }),
    propertyZipcode: Property.ShortText({
      displayName: 'Property Zipcode',
      required: false,
    }),
    beds: Property.Number({
      displayName: 'Beds',
      required: false,
    }),
    baths: Property.Number({
      displayName: 'Baths',
      required: false,
    }),
    sqft: Property.Number({
      displayName: 'SqFt',
      required: false,
    }),
    mlsNumber: Property.ShortText({
      displayName: 'MLS Number',
      required: false,
    }),
    closingDate: Property.ShortText({
      displayName: 'Closing Date',
      description: 'YYYY-MM-DD',
      required: false,
    }),
    agentId: Property.ShortText({
      displayName: 'Agent ID',
      required: false,
    }),
    agentName: Property.ShortText({
      displayName: 'Agent Name',
      required: false,
    }),
    agentEmail: Property.ShortText({
      displayName: 'Agent Email',
      required: false,
    }),
    source: Property.ShortText({
      displayName: 'Source',
      required: false,
    }),
    note: Property.LongText({
      displayName: 'Note',
      required: false,
    }),
  },
  async run({ auth, propsValue }) {
    const { leadId, transactionId } = propsValue;

    // Field names follow the documented
    // PUT /v1.0/leads/{leadId}/transaction/{transactionId} body schema
    // (https://developer.lofty.com/api-reference/transactions/partially-update-a-transaction).
    // Dates are epoch milliseconds; only supplied fields are applied.
    const payload: any = {};

    if (propsValue.propertyAddress)
      payload.transactionName = propsValue.propertyAddress;
    if (propsValue.transactionType)
      payload.transactionType = propsValue.transactionType;
    if (propsValue.amount !== undefined) payload.homePrice = propsValue.amount;
    if (propsValue.closingDate)
      payload.closeDate = Math.round(
        Date.parse(propsValue.closingDate)
      );
    if (propsValue.agentId) {
      const agentIdNum = Number(propsValue.agentId);
      if (Number.isFinite(agentIdNum)) payload.assignedAgent = agentIdNum;
    }

    const response = await makeRequest(
      auth.secret_text,
      HttpMethod.PUT,
      `/leads/${leadId}/transaction/${transactionId}`,
      payload
    );

    return response;
  },
});

