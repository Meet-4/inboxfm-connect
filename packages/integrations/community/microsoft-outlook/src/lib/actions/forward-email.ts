import { createAction, Property } from '@inboxfm-connect/pieces-framework';
import { microsoftOutlookAuth } from '../common/auth';
import { outlookCommon } from '../common/client';
import { messageIdDropdown } from '../common/props';

export const forwardEmailAction = createAction({
	auth: microsoftOutlookAuth,
	name: 'forwardEmail',
	displayName: 'Forward Email',
	description: 'Forwards an email message.',
	audience: 'both',
	aiMetadata: { description: 'Forwards an existing Outlook message (by message ID) to new recipients, preserving the original body and attachments and prepending an optional comment. Use this to pass an existing email along rather than composing a new one. Not idempotent: each call sends a new forwarded email.', idempotent: false },
	props: {
		messageId: messageIdDropdown({
			displayName: 'Email',
			description: 'Select the email message to forward.',
			required: true,
		}),
		recipients: Property.Array({
			displayName: 'To Email(s)',
			required: true,
		}),
		comment: Property.LongText({
			displayName: 'Comment',
			description: 'Optional comment to include with the forwarded message.',
			required: false,
		}),
	},
	async run(context) {
		const { messageId, comment } = context.propsValue;
		const recipients = context.propsValue.recipients as string[];

		const client = outlookCommon.createClient(context.auth);

		// Graph's forward action takes only `comment` and `toRecipients` in its
		// JSON body (the service composes the FW: subject, the forwarded body and
		// carries the original message's own attachments over by itself), and a
		// successful call returns `202 Accepted` with no response body — so there
		// is no new message id to read back.
		// https://learn.microsoft.com/en-us/graph/api/message-forward?view=graph-rest-1.0
		await client
			.api(`${outlookCommon.mailboxPrefix(context.auth)}/messages/${messageId}/forward`)
			.post({
				comment: comment ?? '',
				toRecipients: recipients.map((mail) => ({
					emailAddress: {
						address: mail,
					},
				})),
			});

		return {
			success: true,
			message: 'Email forwarded successfully.',
			originalMessageId: messageId,
		};
	},
});
