import dns from 'node:dns/promises'
import net from 'node:net'
import os from 'os'
import { isNil } from '@inboxfm-connect/core-utils'
import { FastifyRequest } from 'fastify'

const GOOGLE_DNS = '216.239.32.10'
const PUBLIC_IP_ADDRESS_QUERY = 'o-o.myaddr.l.google.com'

type IpMetadata = {
    ip: string
}

let ipMetadata: IpMetadata | undefined

const getLocalIp = (): string | null => {
    const networkInterfaces = os.networkInterfaces()
    for (const interfaceName of Object.keys(networkInterfaces)) {
        const networkInterface = networkInterfaces[interfaceName]
        if (networkInterface) {
            for (const iface of networkInterface) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    return iface.address
                }
            }
        }
    }
    return null
}

const getPublicIp = async (): Promise<IpMetadata> => {
    if (ipMetadata !== undefined) {
        return ipMetadata
    }

    try {
        dns.setServers([GOOGLE_DNS])

        const ipList = await dns.resolve(PUBLIC_IP_ADDRESS_QUERY, 'TXT')

        ipMetadata = {
            ip: ipList[0][0],
        }

        return ipMetadata
    }
    catch (error) {
        const localIp = getLocalIp()
        if (localIp) {
            ipMetadata = {
                ip: localIp,
            }
            return ipMetadata
        }
        throw error
    }
}

// The configured client-IP header (x-real-ip by default — see
// AppSystemProp.CLIENT_REAL_IP_HEADER) is only trustworthy when the TCP peer
// that delivered the request is a proxy the operator controls: any directly
// connected client can send arbitrary values for it. Every IP-keyed rate limit
// (the authn/abuse tiers in core/security/rate-limit.ts, the public-ingress
// limiter, the per-IP axis of every @fastify/rate-limit route) buckets on the
// value returned here, so an attacker rotating the header would get a fresh
// bucket per request and fully bypass those limits (spoofable-key class).
// Gate it on the socket address — which the client cannot choose — and fall
// back to it everywhere else: the proxy position (loopback/private network,
// incl. IPv6-mapped forms) keeps honoring the header the proxy overwrote
// (nginx `proxy_set_header X-Real-IP $remote_addr`), and direct exposure keys
// on the real socket address.
const extractClientRealIp = (request: FastifyRequest, clientIpHeader: string | undefined): string => {
    if (!isNil(clientIpHeader) && isTrustedProxyPeer(request.socket.remoteAddress)) {
        const headerValue = request.headers[clientIpHeader.toLowerCase()] ?? request.headers[clientIpHeader]
        const resolved = parseClientIpHeaderValue(Array.isArray(headerValue) ? headerValue[0] : headerValue)
        if (resolved) {
            return resolved
        }
    }
    return request.ip
}

// The header must carry a single well-formed IP (the first entry of a
// comma-separated list — the x-forwarded-for shape). Anything else is not an
// identity to bucket on: a non-IP string is indistinguishable from an attacker
// minting identities, so it collapses to the socket-address bucket instead of
// becoming a fresh one.
function parseClientIpHeaderValue(rawValue: string | undefined): string | null {
    const trimmed = rawValue?.trim()
    if (isNil(trimmed)) {
        return null
    }
    const firstEntry = trimmed.split(',')[0]?.trim() ?? ''
    return net.isIP(firstEntry) !== 0 ? firstEntry : null
}

// Proxy-capable sockets: loopback, RFC1918 private ranges, link-local, and
// IPv6 unique-local — the positions a reverse proxy / container / load
// balancer realistically sits in. A public peer is an end client: its headers
// are attacker-controlled.
function isTrustedProxyPeer(address: string | undefined): boolean {
    if (isNil(address)) {
        return false
    }
    const normalized = unmapIPv6(address)
    if (net.isIPv4(normalized)) {
        return isTrustedProxyIPv4(normalized)
    }
    if (net.isIPv6(normalized)) {
        return isTrustedProxyIPv6(normalized)
    }
    return false
}

function unmapIPv6(address: string): string {
    // Node normalizes ::ffff:a.b.c.d to the mapped IPv4 in some paths but not
    // others; handle the explicit dotted form.
    const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address.toLowerCase())
    return match ? match[1] : address
}

function isTrustedProxyIPv4(ip: string): boolean {
    const [first, second] = ip.split('.').map((octet) => Number.parseInt(octet, 10))
    if (first === 127 || first === 10) {
        return true
    }
    if (first === 172 && second >= 16 && second <= 31) {
        return true
    }
    if (first === 192 && second === 168) {
        return true
    }
    // Link-local 169.254/16 is where Docker's embedded DNS and some overlay
    // network proxies present themselves.
    return first === 169 && second === 254
}

function isTrustedProxyIPv6(ip: string): boolean {
    const lower = ip.toLowerCase()
    if (lower === '::1') {
        return true
    }
    // fe80::/10 link-local
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
        return true
    }
    // fc00::/7 unique-local
    return lower.startsWith('fc') || lower.startsWith('fd')
}

const getRequestHost = (req: FastifyRequest): string => {
    // in Cloud edition custom hostnames x-forwareded-host will be the original custom hostname while req.hostname will be our main cloud hostname
    const xfh = req.headers['x-forwarded-host']
    const forwardedHost = (Array.isArray(xfh) ? xfh[0] : xfh)?.split(',')[0]?.trim()
    return forwardedHost ?? req.hostname
}

const getRequestBaseUrl = (req: FastifyRequest): string => {
    const forwardedProto = req.headers['x-forwarded-proto'] as string | undefined
    const protocol = forwardedProto?.split(',')[0]?.trim() ?? req.protocol
    return `${protocol}://${getRequestHost(req)}`
}

export const networkUtils = {
    extractClientRealIp,
    getPublicIp,
    getRequestHost,
    getRequestBaseUrl,
    combineUrl(url: string, path: string) {
        const cleanedUrl = cleanTrailingSlash(url)
        const cleanedPath = cleanLeadingSlash(path)
        return `${cleanedUrl}/${cleanedPath}`
    },
}

function cleanLeadingSlash(url: string): string {
    return url.startsWith('/') ? url.slice(1) : url
}

function cleanTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url
}
