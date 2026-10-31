---
"@inboxfm-connect/sdk": patch
---

Kept the documented ConnectError-only contract when a success response's body is not JSON.

The README promises "Every failed request rejects with a `ConnectError` (never a bare
`Error`)", but a 2xx whose body is not the promised JSON — an HTML error page from a
captive portal or misrouted gateway, an empty body — made the response's JSON parse
throw a bare `SyntaxError`. Callers whose only error handling is `instanceof
ConnectError` never fired, and the error carried no category. Such failures now
reject with a `ConnectError` of category `server` (retryable in principle; the
transport had already returned, so it is not retried), with the parse failure
preserved as `error.cause`.
