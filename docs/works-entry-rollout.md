# Works: login before website services

This is a staged change. The current Cloudflare routes and GitHub Pages publication do not change when this code is deployed with the entry flag unset. The existing Google client, refresh grant, MCP/OAuth endpoints, schedule API key and D1 datasets are left alone.

## Requirements before activation

1. Under the same Google Auth Platform project as Homes, create a **separate Web OAuth client** for Works. Register `https://works.lrnr.jp/auth/callback` as its exact redirect URI. Only the `openid email` scopes are requested for entry. The consent screen uses the project's shared Branding and Audience; do not rename Homes or change existing test users to install this client. Confirm the existing Works owner can use this project. Do not add other users by default: the website is the current owner's workspace, not tenant-isolated.
2. In the existing Works Worker add only `WORKS_ENTRY_GOOGLE_CLIENT_ID`, `WORKS_ENTRY_GOOGLE_CLIENT_SECRET`, and an independent random `WORKS_ENTRY_SESSION_SECRET` (at least 32 bytes). Put secrets in Cloudflare Secrets, never source, a GitHub comment, or chat. Do not rotate `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` or the Calendar grant. `WORKS_WEB_ASSETS` is packaged by the checked-in asset build.
3. Keep the original four Cloudflare routes. Add a lower-precedence catch-all `works.lrnr.jp/*` on the same Worker in the **same activation window** as setting `WORKS_ENTRY_ENABLED=true`; the existing API, MCP and OAuth routes remain intact. Do not deploy a catch-all with the flag off. Verify credentials, deployment and zone before switching. With no gate credentials and the flag on, the UI intentionally fails closed.
4. With no cookie, verify root and deep links show the new login and a private asset request has no body. Confirm successful redirect from an allowed account, refusal of a non-allowed account without exposing its email, and availability of Todo, Memo, and teaching/Calendar. Confirm that ordinary sign-out invalidates only the web cookie, and that MCP authorization metadata, existing connector reads and daily teaching jobs still work.
5. Have GitHub Pages publish its launcher only or stop serving the old app. The default GitHub Pages hostname and any preview/legacy hostname must not serve an alternate copy of the app UI. Confirm redirects and inspect actual responses, not just the on-site navigation. The public source repository is separate from service access and is not changed to private in this rollout.

For rollback, restore the previous Pages artifact/origin if it has changed, remove the catch-all, then disable the entry flag. Do not remove existing Works API routes, revoke the old refresh token, or delete the browser-session records. The flag-off client remains the existing implementation.

## Verification in a checkout

Stage reviewed changes before running the packager; it intentionally refuses unstaged tracked changes.

```sh
node scripts/stage-works-entry.mjs
node --test scripts/test/*.test.mjs
cd worker && npm ci && npm test
npx wrangler deploy --dry-run
```

The local Worker tests use signed synthetic identities and a local D1. They do not establish that the production Google OAuth client, custom route or old Pages hostname has been configured.
