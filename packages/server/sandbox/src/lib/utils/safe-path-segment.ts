import { ActivepiecesError, ErrorCode } from '@inboxfm-connect/core-utils'

// Path-segment guard for identifiers that get joined into sandbox cache paths
// (codes/<flowVersionId>/<stepName>, bundles/<flowVersionId>). The API-side zod
// schemas already constrain these (STEP_NAME_REGEX etc.), but the sandbox is a
// trust boundary of its own — flowVersionId and platformId are already guarded
// at this layer for exactly this reason, and the code-step name arrives from
// ProvisionInput payloads. A traversal segment would otherwise move the
// compiled-step directory (write, rm -rf on cache-key change, and bun install
// with it as cwd) or the bundle cache.json outside the sandbox cache root.
export function assertSafePathSegment(value: string, field: string): void {
    const isUnsafe = value.length === 0
        || value === '.'
        || value === '..'
        || value.includes('..')
        || value.includes('/')
        || value.includes('\\')
        || value.includes('\0')
    if (isUnsafe) {
        const message = `Invalid ${field}: "${value}" — path segment contains disallowed characters`
        throw new ActivepiecesError({
            code: ErrorCode.VALIDATION,
            params: { message },
        }, message)
    }
}
