---
"@inboxfm-connect/sdk": patch
---

Surfaced the server's real error message on `ConnectError`.

The server's error handler serializes `ActivepiecesError` bodies as `{ code,
params }` with no top-level `message`, so the SDK resolved `error.message` to the
generic `Inboxfm Connect API error (400/403/…)` for every such failure while the
actual reason sat one level deeper. `error.message` now falls back to
`params.message` (VALIDATION, AUTHORIZATION, ENGINE_OPERATION_FAILURE,
SESSION_EXPIRED, …) and then `params.error` (INVALID_APP_CONNECTION) when the
body has no top-level message — the same priority the web client uses. Fastify's
own errors (zod validation, which do carry a top-level `message`) keep winning,
and bodies with nothing readable still fall back to the generic status string.
