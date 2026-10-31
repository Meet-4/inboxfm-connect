import { describe, expect, it } from 'vitest'
import {
    AcceptUserInvitationRequest,
    InvitationStatus,
    InvitationType,
    ListUserInvitationsRequest,
    SendUserInvitationRequest,
    UserInvitation,
    UserInvitationWithLink,
} from '../../../src/lib/management/invitations/index'
import { PlatformRole } from '../../../src/lib/core/user/user'

describe('InvitationType and InvitationStatus enums', () => {
    it('defines expected enum values', () => {
        expect(InvitationType.PLATFORM).toBe('PLATFORM')
        expect(InvitationType.PROJECT).toBe('PROJECT')

        expect(InvitationStatus.PENDING).toBe('PENDING')
        expect(InvitationStatus.ACCEPTED).toBe('ACCEPTED')
    })
})

describe('UserInvitation and UserInvitationWithLink schemas', () => {
    const validProjectInvitation = {
        id: '123456789012345678901',
        created: '2026-01-01T00:00:00.000Z',
        updated: '2026-01-01T00:00:00.000Z',
        email: 'collaborator@example.com',
        status: InvitationStatus.PENDING,
        type: InvitationType.PROJECT,
        platformId: 'plat-123',
        platformRole: null,
        projectId: 'proj-456',
        projectRoleId: 'role-789',
        projectRole: null,
    }

    it('parses valid project-scoped UserInvitation', () => {
        const parsed = UserInvitation.parse(validProjectInvitation)
        expect(parsed.email).toBe('collaborator@example.com')
        expect(parsed.type).toBe(InvitationType.PROJECT)
        expect(parsed.projectId).toBe('proj-456')
    })

    it('parses platform-scoped UserInvitation with platformRole', () => {
        const platformInvitation = {
            ...validProjectInvitation,
            type: InvitationType.PLATFORM,
            projectId: null,
            projectRoleId: null,
            platformRole: PlatformRole.ADMIN,
        }
        const parsed = UserInvitation.parse(platformInvitation)
        expect(parsed.type).toBe(InvitationType.PLATFORM)
        expect(parsed.platformRole).toBe(PlatformRole.ADMIN)
    })

    it('parses UserInvitationWithLink containing optional invitation link', () => {
        const invitationWithLink = {
            ...validProjectInvitation,
            link: 'https://cloud.inboxfm.com/invitation?token=xyz123',
        }
        const parsed = UserInvitationWithLink.parse(invitationWithLink)
        expect(parsed.link).toBe('https://cloud.inboxfm.com/invitation?token=xyz123')
    })
})

describe('SendUserInvitationRequest union schema', () => {
    it('parses PROJECT invitation request', () => {
        const projectReq = {
            type: InvitationType.PROJECT,
            email: 'dev@company.com',
            projectId: 'proj-123',
            projectRole: 'Editor',
        }
        const parsed = SendUserInvitationRequest.parse(projectReq)
        expect(parsed.type).toBe(InvitationType.PROJECT)
        if (parsed.type === InvitationType.PROJECT) {
            expect(parsed.projectId).toBe('proj-123')
            expect(parsed.projectRole).toBe('Editor')
        }
    })

    it('parses PLATFORM invitation request', () => {
        const platformReq = {
            type: InvitationType.PLATFORM,
            email: 'admin@company.com',
            platformRole: PlatformRole.MEMBER,
        }
        const parsed = SendUserInvitationRequest.parse(platformReq)
        expect(parsed.type).toBe(InvitationType.PLATFORM)
        if (parsed.type === InvitationType.PLATFORM) {
            expect(parsed.platformRole).toBe(PlatformRole.MEMBER)
        }
    })

    it('rejects invalid invitation variants', () => {
        // Missing projectId for PROJECT variant
        expect(() => SendUserInvitationRequest.parse({
            type: InvitationType.PROJECT,
            email: 'dev@company.com',
            projectRole: 'Editor',
        })).toThrow()

        // Missing platformRole for PLATFORM variant
        expect(() => SendUserInvitationRequest.parse({
            type: InvitationType.PLATFORM,
            email: 'dev@company.com',
        })).toThrow()
    })
})

describe('SendUserInvitationRequest email validation', () => {
    it('rejects a CRLF header-injection recipient (would mis-deliver the invitation mail)', () => {
        // 'victim@x.com\r\nBcc: attacker@evil.com' reaches nodemailer's To: header
        // today: the address parser turns it into a group and the SMTP envelope
        // ends up delivering ONLY to the attacker address (empirically verified
        // against nodemailer 8.0.5's stream transport).
        const injected = 'victim@x.com\r\nBcc: attacker@evil.com'
        expect(() => SendUserInvitationRequest.parse({
            type: InvitationType.PROJECT,
            email: injected,
            projectId: 'proj-123',
            projectRole: 'Editor',
        })).toThrow()
        expect(() => SendUserInvitationRequest.parse({
            type: InvitationType.PLATFORM,
            email: injected,
            platformRole: PlatformRole.MEMBER,
        })).toThrow()
    })

    it('rejects LF-only and CR-only variants', () => {
        for (const email of ['victim@x.com\nBcc: attacker@evil.com', 'victim@x.com\rBcc: attacker@evil.com']) {
            expect(() => SendUserInvitationRequest.parse({
                type: InvitationType.PLATFORM,
                email,
                platformRole: PlatformRole.MEMBER,
            })).toThrow()
        }
    })

    it('rejects display-name / whitespace / multi-address forms', () => {
        // A space inside an unquoted address makes nodemailer split it into a
        // display-name part plus the REAL recipient, so the mail still goes to
        // the wrong mailbox.
        for (const email of [
            'Weird Name <victim@x.com>',
            'attacker@evil.com victim@x.com',
            'not-an-email',
            'a@b@c',
            'victim@',
            '',
        ]) {
            expect(() => SendUserInvitationRequest.parse({
                type: InvitationType.PLATFORM,
                email,
                platformRole: PlatformRole.MEMBER,
            })).toThrow()
        }
    })

    it('accepts ordinary and tagged email addresses unchanged', () => {
        for (const email of ['dev@company.com', 'racer@example.com', 'first.last+tag@example.co.uk']) {
            const parsed = SendUserInvitationRequest.parse({
                type: InvitationType.PLATFORM,
                email,
                platformRole: PlatformRole.MEMBER,
            })
            expect(parsed.email).toBe(email)
        }
    })
})

describe('AcceptUserInvitationRequest and ListUserInvitationsRequest schemas', () => {
    it('parses AcceptUserInvitationRequest with token', () => {
        const parsed = AcceptUserInvitationRequest.parse({ invitationToken: 'token_abc123' })
        expect(parsed.invitationToken).toBe('token_abc123')
    })

    it('rejects AcceptUserInvitationRequest without token', () => {
        expect(() => AcceptUserInvitationRequest.parse({})).toThrow()
    })

    it('parses ListUserInvitationsRequest with limit coercion and nullable projectId', () => {
        const req = {
            limit: '25',
            cursor: 'cur_next',
            type: InvitationType.PROJECT,
            projectId: 'proj-123',
            status: InvitationStatus.PENDING,
        }
        const parsed = ListUserInvitationsRequest.parse(req)
        expect(parsed.limit).toBe(25)
        expect(parsed.projectId).toBe('proj-123')
        expect(parsed.status).toBe(InvitationStatus.PENDING)
    })

    it('allows null projectId for platform-wide invitation listing', () => {
        const req = {
            type: InvitationType.PLATFORM,
            projectId: null,
        }
        const parsed = ListUserInvitationsRequest.parse(req)
        expect(parsed.projectId).toBeNull()
        expect(parsed.type).toBe(InvitationType.PLATFORM)
    })
})
