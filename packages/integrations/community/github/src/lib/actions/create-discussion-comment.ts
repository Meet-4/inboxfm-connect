import { githubAuth } from '../auth';
import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { githubApiCall, githubCommon } from '../common';
import { HttpMethod } from '@inboxfm-connect/pieces-common';

export const githubCreateDiscussionCommentAction = createAction({
  auth: githubAuth,
  name: 'github_create_discussion_comment',
  displayName: 'Create Discussion Comment',
  description: 'Creates a comment on a discussion in a GitHub repository',
  audience: 'both',
  aiMetadata: {
    description:
      'Posts a comment on a GitHub Discussion (via the GraphQL API) identified by its discussion ID. Use to reply to a repository discussion thread. Not idempotent: each call adds a new comment.',
    idempotent: false,
  },
  props: {
    repository: githubCommon.repositoryDropdown,
    discussion_number: Property.Number({
      displayName: 'Discussion Number',
      description: 'The number of the discussion to comment on',
      required: true,
    }),
    body: Property.LongText({
      displayName: 'Comment Body',
      description: 'The content of the comment (supports markdown)',
      required: true,
    }),
  },
  async run({ auth, propsValue }) {
    const { discussion_number, body } = propsValue;
    const { owner, repo } = propsValue.repository!;

    // `addDiscussionComment` only accepts `body` and the discussion's GraphQL
    // node ID (`AddDiscussionCommentInput` has no repositoryName/repositoryOwner
    // fields), so the discussion number must be resolved to its node ID first.
    // https://docs.github.com/en/graphql/reference/mutations#adddiscussioncomment
    const discussionIdLookup = await githubApiCall<{
      data?: { repository?: { discussion?: { id?: string } | null } | null };
      errors?: Array<{ message: string }>;
    }>({
      auth,
      method: HttpMethod.POST,
      resourceUri: '/graphql',
      body: {
        query: `
          query GetDiscussionId($owner: String!, $repo: String!, $number: Int!) {
            repository(owner: $owner, name: $repo) {
              discussion(number: $number) {
                id
              }
            }
          }`,
        variables: {
          owner,
          repo,
          number: discussion_number,
        },
      },
    });

    if (discussionIdLookup.body.errors?.length) {
      throw new Error(
        `Failed to look up discussion #${discussion_number}: ${discussionIdLookup.body.errors[0].message}`
      );
    }

    const discussionId =
      discussionIdLookup.body.data?.repository?.discussion?.id;
    if (!discussionId) {
      throw new Error(
        `Discussion #${discussion_number} was not found in ${owner}/${repo}. Check that the repository has Discussions enabled and the discussion number is correct.`
      );
    }

    const response = await githubApiCall<{
      data?: {
        addDiscussionComment?: {
          comment?: {
            id?: string;
            body?: string;
            createdAt?: string;
            url?: string;
          };
        };
      };
      errors?: Array<{ message: string }>;
    }>({
      auth,
      method: HttpMethod.POST,
      resourceUri: '/graphql',
      body: {
        // Pass the body through variables instead of interpolating it into the
        // query string: markdown bodies contain newlines and quotes that would
        // break the GraphQL string literal.
        query: `
          mutation AddDiscussionComment($input: AddDiscussionCommentInput!) {
            addDiscussionComment(input: $input) {
              comment {
                id
                body
                createdAt
                url
              }
            }
          }`,
        variables: {
          input: {
            discussionId,
            body,
          },
        },
      },
    });

    if (response.body.errors?.length) {
      throw new Error(
        `Failed to add comment to discussion #${discussion_number}: ${response.body.errors[0].message}`
      );
    }

    return response;
  },
});

