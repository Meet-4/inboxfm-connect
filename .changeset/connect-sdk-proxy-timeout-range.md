---
"@inboxfm-connect/sdk": patch
---

Normalized the proxy request's upstream `timeoutMs` into the range the server accepts.

`proxy()` reuses its `timeoutMs` option as the server-side upstream budget in the
request body, but the server's `ConnectProxyRequest` schema only accepts integers in
`[500, 60000]` ms (default 30000). A caller asking for a perfectly reasonable client
budget outside that window — e.g. two minutes of client patience, or a sub-500ms
probe — put the raw value into the body and the server rejected every such call with
400 VALIDATION. Non-finite values were worse: `JSON.stringify` writes `NaN` as
`null`, which the schema also rejects.

The forwarded value is now clamped/rounded into the accepted window (in-range values
pass through untouched) and dropped when unusable so the server default applies. The
caller's client-side transport timeout is unaffected — a 120s `timeoutMs` still
grants a 120s per-attempt client budget while the upstream call runs with the
server's 60s ceiling.
