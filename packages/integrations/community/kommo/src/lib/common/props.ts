import { Property, DropdownOption } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { makeRequest, fetchKommoList } from './index';
import { kommoAuth } from '../auth';

interface KommoAuth {
  subdomain: string;
  apiToken: string;
}

export const pipelineDropdown = (required = false) => Property.Dropdown({
  auth: kommoAuth,
  displayName: 'Pipeline',
  required,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your Kommo account',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    const pipelines = await makeRequest({ subdomain, apiToken }, HttpMethod.GET, '/leads/pipelines');

    const options: DropdownOption<number>[] = (pipelines._embedded?.pipelines || []).map(
      (pipeline: any) => ({
        label: pipeline.name,
        value: pipeline.id
      })
    );

    return {
      disabled: false,
      options,
    };
  },
});

export const statusDropdown = (required = false) => Property.Dropdown({
  auth: kommoAuth,
  displayName: 'Status',
  required,
  refreshers: ['pipelineId'],
  options: async ({ auth, pipelineId }) => {
    if (!auth || !pipelineId) {
      return {
        disabled: true,
        placeholder: 'Select a pipeline first',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    const statuses = await makeRequest(
      { subdomain, apiToken },
      HttpMethod.GET,
      `/leads/pipelines/${pipelineId}/statuses`
    );

    const options: DropdownOption<number>[] = (statuses._embedded?.statuses || []).map(
      (status: any) => ({
        label: status.name,
        value: status.id,
      })
    );

    return {
      disabled: false,
      options,
    };
  },
});

export const userDropdown = (required = false) => Property.Dropdown({
  auth: kommoAuth,
  displayName: 'Unique identified of a responsible user',
  required,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your Kommo account',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    const users = await makeRequest({ subdomain, apiToken }, HttpMethod.GET, '/users');

    const options: DropdownOption<number>[] = (users._embedded?.users || []).map((user: any) => ({
      label: `${user.name} (${user.email})`,
      value: user.id,
    }));

    return {
      disabled: false,
      options,
    };
  },
});

export const lossReasonDropdown = (required = false) => Property.Dropdown({
  auth: kommoAuth,
  displayName: 'Loss Reason',
  required,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your Kommo account',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    const reasons = await makeRequest({ subdomain, apiToken }, HttpMethod.GET, '/leads/loss_reasons');

    const options: DropdownOption<number>[] = (reasons._embedded?.loss_reasons || []).map(
      (reason: any) => ({
        label: reason.name,
        value: reason.id,
      })
    );

    return {
      disabled: false,
      options,
    };
  },
});

export const leadDropdown = Property.Dropdown<string, true, typeof kommoAuth>({
  auth: kommoAuth,
  displayName: 'Lead',
  required: true,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your Kommo account',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    // GET /api/v4/leads paginates (page + limit, max 250 per page) — walk
    // the pages with a bounded budget so the dropdown is not silently
    // capped at the first page.
    // https://www.kommo.com/developers/content/crm_platform/leads-api
    const { items: leads, truncated } = await fetchKommoList<{ id: number; name: string }>(
      { subdomain, apiToken },
      '/leads',
      'leads'
    );

    const options: DropdownOption<string>[] = leads.map((lead: any) => ({
      label: lead.name,
      value: lead.id.toString(),
    }));

    if (truncated) {
      options.push({
        label: '⚠️ Could not load all leads (partial list)',
        value: '__truncated_notice__',
      });
    }

    return {
      disabled: false,
      options,
    };
  },
});

export const companyDropdown = Property.Dropdown<string, false, typeof kommoAuth>({
  auth: kommoAuth,
  displayName: 'Company',
  required: false,
  refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your Kommo account',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    const { items: companies, truncated } = await fetchKommoList<{ id: number; name: string }>(
      { subdomain, apiToken },
      '/companies',
      'companies'
    );

    const options: DropdownOption<string>[] = companies.map(
      (company: any) => ({
        label: company.name,
        value: company.id.toString(),
      })
    );

    if (truncated) {
      options.push({
        label: '⚠️ Could not load all companies (partial list)',
        value: '__truncated_notice__',
      });
    }

    return {
      disabled: false,
      options,
    };
  },
});

export const contactDropdown = Property.Dropdown<string, false, typeof kommoAuth>({
  auth: kommoAuth,
    displayName: 'Contact',
    required: false,
    refreshers: [],
  options: async ({ auth }) => {
    if (!auth) {
      return {
        disabled: true,
        placeholder: 'Please connect your Kommo account',
        options: [],
      };
    }

    const { subdomain, apiToken } = auth.props;
    const { items: contacts, truncated } = await fetchKommoList<{ id: number; name: string }>(
      { subdomain, apiToken },
      '/contacts',
      'contacts'
    );

    const options: DropdownOption<string>[] = contacts.map(
      (contact: any) => ({
        label: contact.name,
        value: contact.id.toString(),
      })
    );

    if (truncated) {
      options.push({
        label: '⚠️ Could not load all contacts (partial list)',
        value: '__truncated_notice__',
      });
    }

    return {
      disabled: false,
      options,
    };
  },
});

