# Authentication boundary hardening

This change preserves existing browser sessions (email/exp), MCP access tokens,
refresh grants, keys, scopes, explicit consent, one-hour access lifetime, fixed
30-day grant deadline, rotation and five-second same-successor retry. No database
migration, credential, environment binding or Cloudflare security setting is added.

All ordinary browser APIs reject signed tokens containing aud, scope or fid,
including empty claims. MCP calls retain their own audience/scope/family checks.
Legacy MCP access tokens without fid still work on MCP until their original expiry.

Authentication endpoints bound query strings to 8 KiB and bodies to 16 KiB,
including bodies without Content-Length. Public OAuth and browser callback errors
are non-cacheable and suppress internal exceptions; browser callback responses
retain existing CORS headers. Google token failures suppress response, parse and
network exception details. Google revocation uses a form POST body, not a URL
query. Google credential-bearing POSTs reject redirects.

## Rate protection and limits

A token bucket uses only Cloudflare's trusted CF-Connecting-IP header and the
endpoint path. There are no keys, OAuth tokens or client IDs in bucket keys.
Registration allows a burst of 30, token exchange/refresh 240, other authentication
endpoints 120, refilling the same number per minute. Endpoints are independent;
ordinary browser APIs and MCP tool calls are not throttled. Parallel refresh and
response-loss retries count as requests, with ample normal-use headroom. A 429
returns Retry-After (2 seconds for registration, 1 otherwise).

This is best-effort per Worker isolate, bounded to 4096 entries, with stale-entry
pruning and oldest-entry eviction. Multiple isolates, cold starts or IP churn can
bypass the aggregate limit. A shared NAT IP can also temporarily receive 429 under
an unusually large burst or an attack from that same IP. Local requests with no
trusted client-IP header skip the rate budget but still enforce input bounds.
It is not a global quota or guaranteed distributed denial-of-service protection.
Stricter distributed controls would require separately approved infrastructure;
none are added here. Validate client request sizes and expected shared-IP traffic
before production release.

## Release

Review and merge the draft PR only after approval, then use the existing authorized
main-branch Worker deployment process. No forced reconnect, new consent or token
reissue is needed for valid existing connections. Validate production deployment
and normal client behavior only after release authorization; tests use local D1,
synthetic credentials and intercepted HTTPS requests. Rollback reopens the old
API boundary, so prefer fixing forward if a compatibility problem appears.

## Validation and independent review

- Full local suite: 50 tests passed (`npm test`).
- Updated boundary/refresh cases: authentic issued and revoked MCP access cannot
  reach browser APIs; browser bearer sessions and MCP read/write remain functional.
- Chromium synthetic HTTPS flow passed using the system Chromium executable.
  The existing harness emits a page-close CDP warning at teardown, then reports
  PASS and exits 0; no live network or credentials are used.
- `node --check src/index.js` and `git diff --check` passed.
- Independent read-only review found callback CORS and registration Retry-After
  compatibility issues; both were corrected and re-reviewed with no blockers.
  Reviewer also independently ran relevant authentication/KDP suites successfully.

Production traffic, deployment state and external rate controls are unverified.

## Worker redirect compatibility correction

PR98 used `redirect: "error"` on Google token and revocation POSTs. Unlike Node's
fetch, the deployed Workers runtime rejects that mode before sending a request.
The caught runtime error prevented Google access-token renewal, including schedule
reads, while MCP OAuth refresh itself continued to succeed. Replace those two
options with `manual`; the token helper's non-2xx check rejects redirects without
forwarding credentials. Keys, saved refresh tokens, grants and deadlines do not
change, and users should retain their existing connection.

The regression test runs the actual source inside workerd, with local D1 and
network-disabled synthetic upstreams. It renews an existing-format MCP grant in
parallel, recovers the same successor, preserves expiry and reads a schedule using
an already stored Google refresh credential. It also checks that Google 302/307
responses never send a request to Location, and revocation uses form-body POST.
The original Node-level mocks remain useful for redaction but cannot establish
Workers option compatibility. This test is included by the existing npm test glob.
