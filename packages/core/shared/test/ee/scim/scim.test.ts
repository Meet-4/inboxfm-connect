import { describe, expect, it } from 'vitest'
import { CreateScimUserRequest, SCIM_USER_SCHEMA } from '../../../src/lib/ee/scim'

describe('CreateScimUserRequest userName validation', () => {
    it('rejects a CRLF header-injection recipient (welcome mail would mis-deliver)', () => {
        // userName is the sole source for BOTH the stored identity email and the
        // SMTP envelope recipient of the welcome mail sent on SCIM user creation
        // (scim-user-service.create -> emailService.sendScimUserWelcome ->
        // emails: [userName]). With a CR/LF pair inside, nodemailer 8.0.5
        // parses the To: address as a group and the envelope ends up
        // delivering ONLY to the attacker address (verified against its
        // stream transport).
        expect(() => CreateScimUserRequest.parse({
            schemas: [SCIM_USER_SCHEMA],
            userName: 'victim@x.com\r\nBcc: attacker@evil.com',
        })).toThrow()
    })

    it('rejects LF-only and CR-only variants', () => {
        for (const userName of ['victim@x.com\nBcc: attacker@evil.com', 'victim@x.com\rBcc: attacker@evil.com']) {
            expect(() => CreateScimUserRequest.parse({
                schemas: [SCIM_USER_SCHEMA],
                userName,
            })).toThrow()
        }
    })

    it('rejects non-email and address-splitting forms', () => {
        // A space inside an unquoted address makes nodemailer split it into a
        // display-name part plus the REAL recipient, so the mail still goes to
        // the wrong mailbox. A userName that is not an email at all is also
        // semantically invalid for this service provider: it is stored as the
        // identity's email, an identity that can then never sign in by email.
        for (const userName of ['jdoe', 'a b@x.com', 'victim@', 'a@b@c']) {
            expect(() => CreateScimUserRequest.parse({
                schemas: [SCIM_USER_SCHEMA],
                userName,
            })).toThrow()
        }
    })

    it('accepts ordinary email addresses unchanged (case is kept for the service to normalize)', () => {
        for (const userName of ['dev@company.com', 'first.last+tag@example.co.uk', 'Dev@Company.com']) {
            const parsed = CreateScimUserRequest.parse({
                schemas: [SCIM_USER_SCHEMA],
                userName,
            })
            expect(parsed.userName).toBe(userName)
        }
    })
})
