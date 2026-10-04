# MCP connection renewal

New authorization-code exchanges issue a one-hour access token and a refresh
credential for a grant with a fixed maximum lifetime of 30 days. Refreshing does
not extend that original deadline. Access expiry is capped at the same deadline.
The optional 30-day browser login cookie and explicit consent remain independent.

Only SHA-256 refresh hashes are stored in D1, in two additive, lazily created
tables. A grant binds the registered client, original scope, authorization origin,
and a keyed credential version. API-key, signing-secret or allowed-account
changes invalidate new grants. MCP calls with new access tokens check grant
revocation and expiry. Existing access tokens keep their original one-hour expiry;
they have no refresh credential, so existing ChatGPT connections need one
reconnection after release. No business tables, permissions or secrets change.

Each refresh atomically advances one grant generation. To handle concurrent
requests or a lost HTTP response, a consumed credential may recover the same
successor for five seconds while that successor is still current. The successor
is derived with a domain-separated HMAC; its plaintext is never persisted. This
bounded retry exception also applies to someone holding the old credential;
outside that fixed window, or after a further generation, reuse revokes the grant
and all its new access tokens. Unknown tokens and incorrect client/resource/scope
requests cannot revoke unrelated grants. Storage failures fail closed.

`POST /oauth/revoke` accepts a refresh `token` and its `client_id`, revoking the
whole grant. Unknown or already revoked tokens return HTTP 200. Browser logout
continues to forget only browser login. Expired grant rows are pruned in bounded
batches during new connections. Retained consumed hashes support reuse detection
for the entire 30-day grant lifetime.

Validation: `npm test`, `npm run test:browser`, `node --check src/index.js`, and
`npx wrangler deploy --dry-run`. All authentication tests use synthetic keys and
local D1; no real OAuth credential is fetched, displayed or created. Production
confirmation reads public discovery metadata and rejects dummy requests only.

Deploy through the existing reviewed main-branch Cloudflare build. The added
tables are created idempotently; no manual migration of existing data is needed.
Rollback can retain the new tables; it disables renewal and new access checks,
so users would again reconnect after one hour. Releasing does not refresh existing
ChatGPT connections automatically: reconnect each app once after publication.
