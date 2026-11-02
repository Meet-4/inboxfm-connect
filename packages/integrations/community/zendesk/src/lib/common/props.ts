import { DynamicPropsValue, Property } from '@inboxfm-connect/pieces-framework';
import {
  HttpMethod,
  AuthenticationType,
  httpClient,
  HttpResponse,
} from '@inboxfm-connect/pieces-common';
import { zendeskAuth } from '../..';

type AuthProps = {
  email: string;
  token: string;
  subdomain: string;
};

interface ZendeskTicket {
  id: number;
  subject: string;
  status: string;
  type?: string;
  requester_id: number;
  assignee_id?: number;
  created_at: string;
  updated_at: string;
}

interface ZendeskTicketsResponse {
  tickets: ZendeskTicket[];
}

interface ZendeskOrganization {
  id: number;
  name: string;
  details?: string;
  created_at: string;
  updated_at: string;
}

interface ZendeskOrganizationsResponse {
  organizations: ZendeskOrganization[];
}

interface ZendeskUser {
  id: number;
  name: string;
  email?: string;
  role?: string;
  created_at: string;
  updated_at: string;
}

interface ZendeskUsersResponse {
  users: ZendeskUser[];
}

interface ZendeskBrand {
  id: number;
  name: string;
  subdomain: string;
  active: boolean;
  default: boolean;
  created_at: string;
  updated_at: string;
}

interface ZendeskBrandsResponse {
  brands: ZendeskBrand[];
}

interface ZendeskCustomRole {
  id: number;
  name: string;
  description: string;
  role_type: number;
  team_member_count: number;
  created_at: string;
  updated_at: string;
}

interface ZendeskCustomRolesResponse {
  custom_roles: ZendeskCustomRole[];
}

interface ZendeskGroup {
  id: number;
  name: string;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface ZendeskGroupsResponse {
  groups: ZendeskGroup[];
}

// Zendesk paginates every list endpoint; responses carry an absolute
// `next_page` URL while more records exist (per_page is capped at 100)
// https://developer.zendesk.com/api-reference/introduction/pagination
const ZENDESK_MAX_PAGES = 50;

export const ZENDESK_TRUNCATED_WARNING =
  '⚠️ Could not load all options (partial list)';

async function fetchAllZendeskList<T>({
  auth,
  initialUrl,
  collectionKey,
}: {
  auth: AuthProps;
  initialUrl: string;
  collectionKey: string;
}): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let truncated = false;
  let url: string | undefined = initialUrl;
  let pageCount = 0;

  while (url && pageCount < ZENDESK_MAX_PAGES) {
    pageCount++;
    const response: HttpResponse<Record<string, unknown>> =
      await httpClient.sendRequest<Record<string, unknown>>({
        url,
        method: HttpMethod.GET,
        authentication: {
          type: AuthenticationType.BASIC,
          username: auth.email + '/token',
          password: auth.token,
        },
      });
    const body: Record<string, unknown> = response.body ?? {};
    const pageItems = (body as Record<string, unknown[]>)[collectionKey];
    if (Array.isArray(pageItems)) {
      items.push(...(pageItems as T[]));
    }
    url = (body['next_page'] as string | null) ?? undefined;
    if (pageCount >= ZENDESK_MAX_PAGES && url) {
      truncated = true;
    }
  }

  return { items, truncated };
}

function withTruncationWarning(
  options: Array<{ label: string; value: string }>,
  truncated: boolean
): Array<{ label: string; value: string }> {
  if (truncated) {
    options.push({
      label: ZENDESK_TRUNCATED_WARNING,
      value: '__truncated_notice__',
    });
  }
  return options;
}


export const ticketIdDropdown =  Property.Dropdown({
  auth: zendeskAuth,
  displayName: 'Ticket',
  description: 'Select the ticket to work with',
  required: true,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: tickets, truncated } = await fetchAllZendeskList<ZendeskTicket>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/tickets.json?per_page=100`,
        collectionKey: 'tickets',
      });

      const options = withTruncationWarning(
        tickets.map((ticket) => ({
          label: `#${ticket.id} - ${ticket.subject} (${ticket.status})`,
          value: ticket.id.toString(),
        })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          tickets.length === 0 ? 'No tickets available' : 'Select a ticket',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading tickets: ${errorMessage}`,
      };
    }
  },
});

export const organizationIdDropdown =  Property.Dropdown({
auth: zendeskAuth,

  displayName: 'Organization',
  description: 'Select the organization to work with',
  required: true,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: organizations, truncated } =
        await fetchAllZendeskList<ZendeskOrganization>({
          auth: authentication.props,
          initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/organizations.json?per_page=100`,
          collectionKey: 'organizations',
        });

      const options = withTruncationWarning(
        organizations.map((org) => ({
          label: `${org.name} (ID: ${org.id})`,
          value: org.id.toString(),
        })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          organizations.length === 0
            ? 'No organizations available'
            : 'Select an organization',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading organizations: ${errorMessage}`,
      };
    }
  },
});

export const userIdDropdown =  Property.Dropdown({
auth: zendeskAuth,

  displayName: 'User',
  description: 'Select the user to work with',
  required: true,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: users, truncated } = await fetchAllZendeskList<ZendeskUser>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/users.json?per_page=100`,
        collectionKey: 'users',
      });

      const options = withTruncationWarning(
        users.map((user) => ({
          label: `${user.name}${user.email ? ` (${user.email})` : ''} - ID: ${
            user.id
          }${user.role ? ` [${user.role}]` : ''}`,
          value: user.id.toString(),
        })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          users.length === 0 ? 'No users available' : 'Select a user',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading users: ${errorMessage}`,
      };
    }
  },
});

export const brandIdDropdown =  Property.Dropdown({
auth: zendeskAuth,

  displayName: 'Brand',
  description: 'Select the brand to work with',
  required: false,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: brands, truncated } = await fetchAllZendeskList<ZendeskBrand>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/brands.json?per_page=100`,
        collectionKey: 'brands',
      });

      const options = withTruncationWarning(
        brands
          .filter((brand) => brand.active)
          .map((brand) => ({
            label: `${brand.name}${brand.default ? ' (Default)' : ''} - ${
              brand.subdomain
            }`,
            value: brand.id.toString(),
          })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          brands.length === 0 ? 'No brands available' : 'Select a brand',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading brands: ${errorMessage}`,
      };
    }
  },
});

export const problemTicketIdDropdown =  Property.Dropdown({
auth: zendeskAuth,

  displayName: 'Problem Ticket',
  description: 'Select the problem ticket this ticket is an incident of',
  required: false,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: tickets, truncated } = await fetchAllZendeskList<ZendeskTicket>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/tickets.json?per_page=100`,
        collectionKey: 'tickets',
      });

      const problemTickets = tickets.filter(
        (ticket) => ticket.type === 'problem'
      );

      const options = withTruncationWarning(
        problemTickets.map((ticket) => ({
          label: `#${ticket.id} - ${ticket.subject} (${ticket.status})`,
          value: ticket.id.toString(),
        })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          problemTickets.length === 0
            ? 'No problem tickets available'
            : 'Select a problem ticket',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading problem tickets: ${errorMessage}`,
      };
    }
  },
});

export const customRoleIdDropdown =  Property.Dropdown({
auth: zendeskAuth,

  displayName: 'Custom Role',
  description: 'Select the custom role for the agent',
  required: false,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: customRoles, truncated } =
        await fetchAllZendeskList<ZendeskCustomRole>({
          auth: authentication.props,
          initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/custom_roles.json?per_page=100`,
          collectionKey: 'custom_roles',
        });

      const options = withTruncationWarning(
        customRoles.map((role) => ({
          label: `${role.name} - ${role.description} (${role.team_member_count} members)`,
          value: role.id.toString(),
        })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          customRoles.length === 0 ? 'No custom roles available' : 'Select a custom role',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading custom roles: ${errorMessage}`,
      };
    }
  },
});

export const agentBrandIdDropdown = Property.MultiSelectDropdown({
  auth: zendeskAuth,
  displayName: 'Agent Brand Access',
  description: 'Select the brands that the agent can access (for agents only)',
  required: false,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: brands, truncated } = await fetchAllZendeskList<ZendeskBrand>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/brands.json?per_page=100`,
        collectionKey: 'brands',
      });

      const options = withTruncationWarning(
        brands
          .filter((brand) => brand.active) // Only show active brands
          .map((brand) => ({
            label: `${brand.name}${brand.default ? ' (Default)' : ''} - ${brand.subdomain}`,
            value: brand.id.toString(),
          })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          brands.length === 0 ? 'No brands available' : 'Select brands for agent access',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading brands: ${errorMessage}`,
      };
    }
  },
});

export const userFieldsDynamicProp = Property.DynamicProperties({
  auth: zendeskAuth,
  displayName: 'User Fields',
  description: 'Custom user field values.',
  required: false,
  refreshers: ['auth'],
  props: async ({ auth }) => {
    if (!auth) return {};

    try {
      const authentication = auth;
      const { items: fields } = await fetchAllZendeskList<{
        key: string;
        title: string;
        description?: string;
        type: string;
        active: boolean;
        custom_field_options?: Array<{ name: string; value: string }>;
        regexp_for_validation?: string;
      }>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/user_fields.json?per_page=100`,
        collectionKey: 'user_fields',
      });

      const dynamicProps: DynamicPropsValue = {};

      for (const field of fields) {
        if (!field.active) continue;

        const fieldKey = `field_${field.key}`;
        const displayName = field.title;
        const description = field.description ?? `Custom ${field.type} field`;

        switch (field.type) {
          case 'tagger':
          case 'dropdown':
            if (field.custom_field_options && field.custom_field_options.length > 0) {
              dynamicProps[fieldKey] = Property.StaticDropdown({
                displayName,
                description,
                required: false,
                options: {
                  disabled: false,
                  placeholder: `Select ${displayName}`,
                  options: field.custom_field_options.map((option) => ({
                    label: option.name,
                    value: option.value,
                  })),
                },
              });
            }
            break;
          case 'multiselect':
            if (field.custom_field_options && field.custom_field_options.length > 0) {
              dynamicProps[fieldKey] = Property.StaticMultiSelectDropdown({
                displayName,
                description,
                required: false,
                options: {
                  options: field.custom_field_options.map((option) => ({
                    label: option.name,
                    value: option.value,
                  })),
                },
              });
            }
            break;
          case 'integer':
          case 'decimal':
            dynamicProps[fieldKey] = Property.Number({
              displayName,
              description,
              required: false,
            });
            break;
          case 'date':
            dynamicProps[fieldKey] = Property.DateTime({
              displayName,
              description,
              required: false,
            });
            break;
          case 'checkbox':
            dynamicProps[fieldKey] = Property.Checkbox({
              displayName,
              description,
              required: false,
            });
            break;
          case 'textarea':
            dynamicProps[fieldKey] = Property.LongText({
              displayName,
              description,
              required: false,
            });
            break;
          case 'regexp':
            dynamicProps[fieldKey] = Property.ShortText({
              displayName,
              description: `${description}${field.regexp_for_validation ? ` (Pattern: ${field.regexp_for_validation})` : ''}`,
              required: false,
            });
            break;
          default:
            dynamicProps[fieldKey] = Property.ShortText({
              displayName,
              description,
              required: false,
            });
        }
      }

      return dynamicProps;
    } catch {
      return {};
    }
  },
});

export const groupIdDropdown =  Property.Dropdown({
auth: zendeskAuth,

  displayName: 'Group',
  description: 'Select the group to assign',
  required: false,
  refreshers: ['auth'],
  options: async (propsValue) => {
    const auth = propsValue.auth;
    if (!auth) {
      return {
        disabled: true,
        options: [],
        placeholder: 'Connect your Zendesk account first',
      };
    }

    try {
      const authentication = auth;
      const { items: groups, truncated } = await fetchAllZendeskList<ZendeskGroup>({
        auth: authentication.props,
        initialUrl: `https://${authentication.props.subdomain}.zendesk.com/api/v2/groups.json?per_page=100`,
        collectionKey: 'groups',
      });

      const options = withTruncationWarning(
        groups.map((group) => ({
          label: `${group.name}${group.is_public ? ' (Public)' : ' (Private)'} - ID: ${group.id}`,
          value: group.id.toString(),
        })),
        truncated
      );

      return {
        disabled: false,
        options,
        placeholder:
          groups.length === 0 ? 'No groups available' : 'Select a group',
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        disabled: true,
        options: [],
        placeholder: `Error loading groups: ${errorMessage}`,
      };
    }
  },
});

