import { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { networkUtils } from '../../../../src/app/helper/network-utils'

const HEADER = 'x-real-ip'

function buildRequest({ headers, ip, remoteAddress }: { headers: Record<string, string>, ip: string, remoteAddress: string }): FastifyRequest {
    return {
        headers,
        ip,
        socket: { remoteAddress },
    } as unknown as FastifyRequest
}

describe('networkUtils.extractClientRealIp', () => {
    describe('trust gating: the configured client-IP header', () => {
        it('is honored when the TCP peer is a local reverse proxy (loopback)', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '198.51.100.10' },
                ip: '127.0.0.1',
                remoteAddress: '127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('198.51.100.10')
        })

        it('is honored when the TCP peer is a private-network proxy (RFC1918)', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '198.51.100.11' },
                ip: '172.17.0.5',
                remoteAddress: '172.17.0.5',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('198.51.100.11')
        })

        it('is IGNORED when the request arrives directly from a public client — the header is spoofable there', () => {
            // A directly connected client controls every header it sends; keying
            // anything (rate limits!) on that value lets the client mint a fresh
            // bucket per request. The socket address must win instead.
            const request = buildRequest({
                headers: { 'x-real-ip': '1.2.3.4' },
                ip: '203.0.113.7',
                remoteAddress: '203.0.113.7',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('203.0.113.7')
        })

        it('is ignored for IPv6-mapped public sockets too', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '1.2.3.4' },
                ip: '::ffff:203.0.113.7',
                remoteAddress: '::ffff:203.0.113.7',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('::ffff:203.0.113.7')
        })

        it('is honored for IPv6-mapped loopback sockets', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '198.51.100.12' },
                ip: '::ffff:127.0.0.1',
                remoteAddress: '::ffff:127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('198.51.100.12')
        })
    })

    describe('value validation: the header value itself', () => {
        it('falls back to the socket address when the header is not an IP address at all', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': 'definitely-not-an-ip' },
                ip: '127.0.0.1',
                remoteAddress: '127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('127.0.0.1')
        })

        it('falls back to the socket address when the header is empty', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '   ' },
                ip: '127.0.0.1',
                remoteAddress: '127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('127.0.0.1')
        })

        it('takes the first entry of a comma-separated list (x-forwarded-for shape)', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '198.51.100.13, 10.0.0.1' },
                ip: '127.0.0.1',
                remoteAddress: '127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('198.51.100.13')
        })

        it('falls back to the socket address when the first list entry is not an IP', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': 'not-an-ip, 198.51.100.13' },
                ip: '127.0.0.1',
                remoteAddress: '127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('127.0.0.1')
        })

        it('accepts an IPv6 header value', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '2001:db8::1' },
                ip: '127.0.0.1',
                remoteAddress: '127.0.0.1',
            })
            expect(networkUtils.extractClientRealIp(request, HEADER)).toBe('2001:db8::1')
        })
    })

    describe('no configured header', () => {
        it('returns the socket address', () => {
            const request = buildRequest({
                headers: { 'x-real-ip': '1.2.3.4' },
                ip: '203.0.113.9',
                remoteAddress: '203.0.113.9',
            })
            expect(networkUtils.extractClientRealIp(request, undefined)).toBe('203.0.113.9')
        })
    })
})
