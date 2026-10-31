---
"@inboxfm-connect/sdk": patch
---

Made the quickstart follow connection pages instead of reading only the first one.

The server pages `GET /v1/connections` (SeekPage, 10 rows per page), and the README
tells developers to "paginate with `cursor`/`limit`" — but the runnable quickstart's
connection lookup read exactly one page and ignored `next`. When the customer's
active connection sat past the first page, the example told an already-connected
customer to reconnect (creating a redundant connect session), and the wait loop
polled page one forever without ever observing the connection it was waiting for,
ending in `Timed out … waiting for … to connect` for a customer who was connected
all along.

`findActiveConnection` now walks `next` until the page is exhausted, with a page cap
so a misbehaving cursor sequence (a repeated cursor makes the server serve the first
page again) cannot loop the walk forever. It is exported so the example tests can
pin the walk directly.
