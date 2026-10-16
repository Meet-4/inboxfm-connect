import { Property } from '@inboxfm-connect/pieces-framework';
import { loftyAuth } from './auth';
import { makeRequest } from './client';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

export const leadIdDropdown = Property.Dropdown({
  auth: loftyAuth,
  displayName: 'Lead',
  description: 'Select a lead',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
      };
    }
    try {
      const response = await makeRequest(
        auth.secret_text,
        HttpMethod.GET,
        '/leads'
      );

      return {
        disabled: false,
        options: response.leads.map((lead: any) => {
          return {
            label: `${lead.firstName} ${lead.lastName}`,
            value: lead.leadId,
          };
        }),
      };
    } catch (e) {
      return {
        disabled: true,
        options: [],
      };
    }
  },
});

export const transactionIdDropdown = Property.Dropdown({
  auth: loftyAuth,
  displayName: 'Transaction',
  description: 'Select a transaction',
  required: true,
  refreshers: ['leadId'],
  options: async ({ auth, leadId }) => {
    if (!auth) {
      return {
        disabled: true,
        options: [],
      };
    }
    if (!leadId) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Select a lead first',
      };
    }
    try {
      const response = await makeRequest(
        auth.secret_text,
        HttpMethod.GET,
        `/leads/${leadId}/transactions`
      );
      // GET /v1.0/leads/{leadId}/transactions returns a bare JSON array,
      // not a { transactions: [...] } envelope.
      const transactions = Array.isArray(response)
        ? response
        : (response?.transactions ?? []);

      return {
        disabled: false,
        options: transactions.map((transaction: any) => {
          return {
            label: `${transaction.leadName} - ${transaction.transactionName}`,
            value: transaction.transactionId,
          };
        }),
      };
    } catch (e) {
      return {
        disabled: true,
        options: [],
      };
    }
  },
});

