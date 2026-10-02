# MCP authorization: optional remembered login

The checkbox belongs to `/oauth/authorize`, the WORKS API-key confirmation page used to connect ChatGPT. It does not change the separate Google login used by the Works web app.

## Behavior

- The checkbox is off by default. With it off, successful key verification grants only the current OAuth request and removes any existing remembered login for that browser.
- Opting in sets a 30-day, fixed-lifetime `__Host-works_mcp_session` cookie. Existing remembered sessions are not extended by reconnecting.
- A returning browser still sees the requested permissions and registered callback URL and must press **接続を許可**. GET requests never issue an OAuth code.
- No API key, password, OAuth access token, or session credential is written to localStorage or sessionStorage by this flow. The browser cookie is Secure, HttpOnly, SameSite=Lax, host-only, and uses Path=/.
- `/oauth/logout` shows a confirmation form. Its POST revokes the server-side remembered session and expires the browser cookies. This only forgets this browser; it does not revoke previously granted ChatGPT access tokens or sign out the web app.
- An expired, revoked, malformed, or rotated-key session falls back to API-key entry. Clearing cookies, switching browsers, or isolated in-app/private browser storage also requires re-entry.

## Storage and security

Two new tables are created idempotently through the existing `ensureMcpOAuthSchema` path:

- `mcp_browser_sessions`: SHA-256 hash of a 256-bit random cookie, credential-version HMAC, fixed expiry
- `mcp_browser_forms`: SHA-256 hashes of one-use form tokens and browser nonces, exact OAuth-request/action hash, current remembered-session hash, credential version, ten-minute expiry

Only hashed session identifiers are stored in D1. The credential-version HMAC uses the existing SESSION_SECRET and WORKS_API_KEY; changing either invalidates remembered login and open forms. The digest also binds sessions and forms to the authorization origin. No new environment binding or signing secret is needed. Old rows are pruned during form generation; expiry is checked during every authentication.

POSTs require same-origin Origin and, when supplied, same-origin Sec-Fetch-Site, plus a URL-encoded form and a browser-bound, action-bound CSRF token. Atomic DELETE RETURNING makes each form one-use. OAuth client, registered redirect, PKCE challenge/method, state, scope, and current session are bound to the form. Parallel pages reuse the short-lived browser nonce. Back/replayed/expired submissions show a fresh form and do not silently authorize.

Authorization HTML uses Referrer-Policy: same-origin to preserve the same-origin POST Origin while suppressing cross-origin callback referrers. It is non-cacheable, cannot be framed, has no scripts or external assets, and limits form destinations to itself and the validated callback origin (for browsers that check redirects against form-action). Logout forms allow only self. API/MCP endpoints do not accept the browser cookie for authorization. OAuth code lifetime (five minutes), MCP access lifetime (one hour), existing scopes, and PKCE exchange remain unchanged.

## Validation

Run from `worker/`:

    npm ci --ignore-scripts
    npm test
    npx playwright install chromium
    npm run test:browser
    node --check src/index.js
    git diff --check

The integration tests use real SQLite through Miniflare D1 and dummy credentials. They cover default-off/on/off-after-save, fixed expiry, key/secret rotation, malformed/revoked sessions, explicit consent, failed credentials, origin/CSRF/request binding, replay/concurrent double-click, parallel forms, storage failure, cross-origin session replay, logout/stale forms, PKCE, and rejection of browser cookies at API/MCP endpoints.

The browser test uses synthetic HTTPS origins, intercepted responses, dummy keys, and an isolated temporary D1. It exercises real Chromium form navigation, cookie handling, reconnect/consent, logout, and mobile width without any real account or external HTTPS request. The PR workflow runs this test before release.

## Release notes

This work is based on `main` at `dd94d60a0ea73c853d073d593568783409c26d3d`. The repository's configured default branch, `claude/universal-app-design-4f5vzj`, is an older snapshot without the MCP authorization route.

Deploy the reviewed Worker change only through the authorized production workflow. No live credentials, database, deployment, or OAuth configuration were changed during implementation. Existing clients may need to reopen an authorization page rendered before the update because the new POST flow requires its CSRF form token. Verify the real callback, browser cookie storage, and logout once after deployment with the owner's approval.
