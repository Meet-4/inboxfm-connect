---
"@inboxfm-connect/sdk": patch
---

Three client-side transport fixes.

`timeoutMs` now covers reading the response body, not just waiting for headers: a
server that sent headers and then stalled the body used to hold the caller for the
runtime's own socket timeout (undici: 5 minutes) and never produced the promised
`ConnectError` of category `timeout`.

Requests no longer leak an `abort` listener on a caller-provided `AbortSignal`. Each
call against a shared signal left one listener (and the request closure it pinned)
behind for the lifetime of the process, which tripped Node's
`MaxListenersExceededWarning` after ten calls.

`proxy()` now gives its own HTTP request at least the budget the server allows for
the upstream call (30s default, 60s maximum, plus a grace window) instead of the
generic 10s client default, so an upstream request taking 10-30s is reported by the
server rather than aborted client-side while the third-party call keeps running.
