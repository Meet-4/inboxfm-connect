import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { loftyAuth } from '../common/auth';
import { makeRequest } from '../common/client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { leadIdDropdown } from '../common/props';

export const createTransaction = createAction({
  auth: loftyAuth,
  name: 'createTransaction',
  displayName: 'Create Transaction',
  description: 'Create a transaction for a Lofty lead',
  audience: 'both',
  aiMetadata: {
    description:
      'Records a new transaction (e.g. a sale or rental deal with amount, property details, dates, and agent) against an existing Lofty lead. Use when logging a deal for a known lead; requires the lead id (selectable from the account or passed directly). Not idempotent: each call appends another transaction, so repeated calls create duplicates.',
    idempotent: false,
  },
  props: {
    leadId: leadIdDropdown,
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
      displayName: 'Transaction Name / Property Address',
      description:
        'Property address or deal name — required by the Lofty API (transactionName)',
      required: true,
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
    const { leadId } = propsValue;

    // Field names follow the documented POST /v1.0/leads/{leadId}/transaction
    // body schema (https://developer.lofty.com/api-reference/transactions/create-transaction).
    // transactionName is required; dates are epoch milliseconds.
    const payload: any = {
      transactionName: propsValue.propertyAddress,
    };

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
      HttpMethod.POST,
      `/leads/${leadId}/transaction`,
      payload
    );

    return response;
  },
});

