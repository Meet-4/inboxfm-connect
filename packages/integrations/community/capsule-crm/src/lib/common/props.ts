import { Property } from '@inboxfm-connect/pieces-framework';
import { capsuleCrmAuth, CapsuleCrmAuthType } from './auth';
import { capsuleCrmClient, capsuleOptions } from './client';

export const capsuleCrmProps = {
  contact_id: (required = true) =>
    Property.Dropdown({
      displayName: 'Contact',
      description: 'The contact (Person or Organisation) to select.',
      required: required,
      refreshers: [],
      auth: capsuleCrmAuth,
      options: async (props) => {
        const { auth } = props;
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }

        const searchTerm = (props['searchValue'] as string) ?? '';

        const contacts = await capsuleCrmClient.searchContacts(
          auth,
          searchTerm
        );

        const options = contacts.items.map((contact) => {
          const label =
            contact.type === 'person'
              ? `${contact.firstName} ${contact.lastName}`
              : contact.name;
          return {
            label: label || 'Unnamed Contact',
            value: contact.id,
          };
        });

        if (contacts.truncated) {
          options.push({
            label: '⚠️ Could not load all contacts (partial list)',
            value: '__truncated_notice__' as unknown as number,
          });
        }

        return {
          disabled: false,
          options: options,
        };
      },
    }),

  milestone_id: (required = true) =>
    Property.Dropdown({
      displayName: 'Milestone',
      description: 'The milestone to assign the opportunity to.',
      required: required,
      refreshers: [],
      auth: capsuleCrmAuth,
      options: async ({ auth }) => {    
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }
        const milestones = await capsuleCrmClient.listMilestones(
          auth
        );
        const options = milestones.items.map((milestone) => {
          return {
            label: milestone.name,
            value: milestone.id,
          };
        });
        if (milestones.truncated) {
          options.push({
            label: '⚠️ Could not load all milestones (partial list)',
            value: '__truncated_notice__' as unknown as number,
          });
        }

        return {
          disabled: false,
          options: options,
        };
      },
    }),

  opportunity_id: (required = true) =>
    Property.Dropdown({
      displayName: 'Opportunity',
      description: 'The opportunity to associate with this item.',
      required: required,
      refreshers: [],
      auth: capsuleCrmAuth,
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }
        const opportunities = await capsuleCrmClient.listOpportunities(
          auth
        );
        return {
          disabled: false,
          options: capsuleOptions(opportunities, 'opportunities', (opportunity) => ({
            label: opportunity.name,
            value: opportunity.id,
          })),
        };
      },
    }),

  project_id: (required = false) =>
    Property.Dropdown({
      displayName: 'Project',
      description: 'The project to associate this item with.',
      required: required,
      refreshers: [],
      auth: capsuleCrmAuth,
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }
        const projects = await capsuleCrmClient.listProjects(
          auth
        );
        return {
          disabled: false,
          options: capsuleOptions(projects, 'projects', (project) => ({
            label: project.name,
            value: project.id,
          })),
        };
      },
    }),

  case_id: (required = false) =>
    Property.Dropdown({
      displayName: 'Case',
      description: 'The case to associate this item with.',
      required: required,
      refreshers: [],
      auth: capsuleCrmAuth,
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }
        const cases = await capsuleCrmClient.listCases(
          auth
        );
        return {
          disabled: false,
          options: capsuleOptions(cases, 'cases', (kase) => ({ label: kase.name, value: kase.id })),
        };
      },
    }),

  owner_id: (required = false) =>
    Property.Dropdown({
      auth: capsuleCrmAuth,
      displayName: 'Owner',
      description: 'The user to assign the task to.',
      required: required,
      refreshers: [],
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }
        const users = await capsuleCrmClient.listUsers(
          auth  
        );
        return {
          disabled: false,
          options: capsuleOptions(users, 'users', (user) => ({
            label: user.username,
            value: user.id,
          })),
        };
      },
    }),

  team_id: (required = false) =>
    Property.Dropdown({
      displayName: 'Team',
      description: 'The team to assign the contact to.',
      required: required,
      refreshers: [],
      auth: capsuleCrmAuth,
      options: async ({ auth }) => {
        if (!auth) {
          return {
            disabled: true,
            placeholder: 'Please connect your account first.',
            options: [],
          };
        }
        const teams = await capsuleCrmClient.listTeams(
          auth
        );
        return {
          disabled: false,
          options: capsuleOptions(teams, 'teams', (team) => ({
            label: team.name,
            value: team.id,
          })),
        };
      },
    }),
};

