import { Property } from '@inboxfm-connect/pieces-framework';
import { HttpMethod } from '@inboxfm-connect/pieces-common';
import { zendeskSellAuth, ZendeskSellAuth } from './auth';
import { callZendeskApi, fetchZendeskSellItems } from './client';

type SellItem = { data: { id: number; name: string } };

// Zendesk Sell paginates every collection with page/per_page (default 25
// per page, maximum 100), so a single unparameterized call silently drops
// everything past the first 25 records. Walk pages with a bounded budget
// and surface a truncation notice when the budget is exhausted.
// https://developer.zendesk.com/api-reference/sales-crm/requests/#pagination
function sellOptions(items: SellItem[], truncated: boolean, resourceLabel: string) {
    const options = items.map((item) => ({ label: item.data.name, value: item.data.id }));
    if (truncated) {
        options.push({
            label: `⚠️ Could not load all ${resourceLabel} (partial list)`,
            value: '__truncated_notice__' as unknown as number,
        });
    }
    return {
        disabled: false,
        options,
    };
}

export const zendeskSellCommon = {
    lead: (required = true) => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Lead',
        required,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) {
                return {
                    disabled: true,
                    placeholder: 'Connect your account first',
                    options: [],
                };
            }
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>('v2/leads', auth);
                return sellOptions(items, truncated, 'leads');
            } catch (error) {
                return { disabled: true, placeholder: "Error fetching leads.", options: [] };
            }
        },
    }),

    contact: (required = true) => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Contact',
        required,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) {
                return {
                    disabled: true,
                    placeholder: 'Connect your account first',
                    options: [],
                };
            }
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>('v2/contacts', auth);
                return sellOptions(items, truncated, 'contacts');
            } catch (error) {
                return { disabled: true, placeholder: "Error fetching contacts.", options: [] };
            }
        },
    }),

    tags: (resourceType: 'contact' | 'lead' | 'deal') => Property.MultiSelectDropdown({
        auth: zendeskSellAuth,
        displayName: 'Tags',
        description: 'A list of tags to associate with the record.',
        required: false,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) {
                return {
                    disabled: true,
                    placeholder: 'Connect your account first',
                    options: [],
                };
            }
            try {
                const { items, truncated } = await fetchZendeskSellItems<{ data: { name: string } }>(
                    'v2/tags',
                    auth,
                    { resource_type: resourceType }
                );
                const options = items.map((item) => ({ label: item.data.name, value: item.data.name }));
                if (truncated) {
                    options.push({
                        label: '⚠️ Could not load all tags (partial list)',
                        value: '__truncated_notice__',
                    });
                }
                return {
                    disabled: false,
                    options,
                };
            } catch (error) {
                console.error("Error fetching Zendesk Sell tags:", error);
                return { disabled: true, placeholder: "Error fetching tags.", options: [] };
            }
        },
    }),

    leadSource: () => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Lead Source',
        description: 'The source of the lead.',
        required: false,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) {
                return {
                    disabled: true,
                    placeholder: 'Connect your account first',
                    options: [],
                };
            }
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>('v2/lead_sources', auth);
                return sellOptions(items, truncated, 'lead sources');
            } catch (error) {
                console.error("Error fetching Zendesk Sell lead sources:", error);
                return { disabled: true, placeholder: "Error fetching lead sources.", options: [] };
            }
        },
    }),

    deal: (required = true) => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Deal',
        required,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) return { disabled: true, placeholder: 'Connect account first', options: [] };
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>('v2/deals', auth);
                return sellOptions(items, truncated, 'deals');
            } catch (e) {
                return { disabled: true, placeholder: 'Error fetching deals', options: [] };
            }
        },
    }),

    company: (required = true) => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Company',
        required,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) return { disabled: true, placeholder: 'Connect account first', options: [] };
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>(
                    'v2/contacts',
                    auth,
                    { is_organization: 'true' }
                );
                return sellOptions(items, truncated, 'companies');
            } catch (e) {
                return { disabled: true, placeholder: 'Error fetching companies', options: [] };
            }
        },
    }),

    pipeline: (required = true) => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Pipeline',
        required,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) return { disabled: true, placeholder: 'Connect account first', options: [] };
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>('v2/pipelines', auth);
                return sellOptions(items, truncated, 'pipelines');
            } catch (e) {
                return { disabled: true, placeholder: 'Error fetching pipelines', options: [] };
            }
        },
    }),

    stage: (required = true) => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Stage',
        required,
        refreshers: ['pipeline_id'],
        options: async (propsValue) => {
            const auth = propsValue.auth
            const pipelineId = propsValue['pipeline_id'] as number | undefined;

            if (!auth || !pipelineId) {
                return { disabled: true, placeholder: 'Select a pipeline first', options: [] };
            }
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>(
                    `v2/pipelines/${pipelineId}/stages`,
                    auth
                );
                return sellOptions(items, truncated, 'stages');
            } catch (e) {
                return { disabled: true, placeholder: 'Error fetching stages', options: [] };
            }
        },
    }),

    owner: () => Property.Dropdown({
        auth: zendeskSellAuth,

        displayName: 'Owner',
        required: false,
        refreshers: [],
        options: async (propsValue) => {
            const auth = propsValue.auth
            if (!auth) return { disabled: true, placeholder: 'Connect account first', options: [] };
            try {
                const { items, truncated } = await fetchZendeskSellItems<SellItem>('v2/users', auth);
                return sellOptions(items, truncated, 'users');
            } catch (e) {
                return { disabled: true, placeholder: 'Error fetching users', options: [] };
            }
        },
    }),
};
