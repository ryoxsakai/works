# Integrated Works release — 2026-10-27

Publication of Workflow, Wiki and personal ToDo was explicitly approved at 00:37 UTC. This is one coordinated release; do not publish the original branches independently.

## Candidate and integration

Base: main `e9371ed19ae929ff97915a4938c27609390dcf71`.

- Workflow: `bbb7a9e0fa35dde17c5a36eb29d4ce8121751a59` (includes c651b16 and f0cceec).
- Wiki: `a8b4e8160ef0b9f7b6e518085656a91a467e0247`, including a5243d7.
- ToDo: `57acf448aeb7981f2577e2ca9fbfed60da063642`, including b798b3c.

Both source git bundles were verified by SHA256 and `git bundle verify` before import. Merge commits retain their original histories. Workflow MCP dispatch routing and both new ToDo clone routes coexist in `worker/src/index.js`; Wiki has no Worker/schema changes. AI roles (`wf_roles`) and personal ToDo hats (JSON `roles`) remain separate.

Integration repairs: shared category/header fixtures now use the actual additive ToDo API shape and new category controls; category CI also runs the complete personal-ToDo suite. Chromium fixtures support the existing executable override while retaining Playwright's standard CI default. Category action touch targets are at least44px. Closing a pending ToDo save restores focus when controls become enabled, without stealing focus from newer dialogs/navigation.

## Verified validation

- Combined Worker unit/API suite: **125 passed**.
- Workflow browser: desktop/mobile, themes, proposals/adoption/bounded planning, no early Run, no-repeat/owner gates, delayed close/newer navigation/history regressions.
- Wiki browser: desktop/mobile creation, citations, comparison/adoption/conflicts, restore metadata, archive/search/export, light/dark contrast.
- ToDo browser: six width/theme scenarios and capture/category/role/cloning/retry/CAS/cross-tab/midnight/dismissal cases.
- Shared category browser: **24 service/width/theme scenarios** across Memo and the redesigned ToDo, including rename/reorder/reassign/delete/empty/focus/Escape/Back/targets.
- Shared header: **120 page/width/auth combinations**, light/dark/print and persistence/cross-tab/OS/navigation/student-memo cases.
- Existing OAuth, KDP, SS, next-lesson and Memo browser suites; Tutor tests; syntax and diff checks pass.

Only synthetic DB/browser data was used. Source screenshots were visually inspected. No real task or external job was launched for validation.

## Production prerequisites and sole-publisher sequence

Existing Mac Wrangler4.107.0 OAuth is verified. Use an isolated checkout/workspace; the user's existing checkout is dirty and must not be reset/overwritten. Keep credentials and DB backups private on that Mac.

Production baseline observed before release: Worker `works`,100% version `1bef09ac-a577-4204-8022-5f09c6c7efb2`, deployed2026-10-19T23:42:29.938Z. Initial feature builds did not replace this serving version. Builds-settings access returned Cloudflare403/code10000: do not retry, expand scope or change security settings. Branch auto-deploy behavior remains unknown; safe ordering below makes a potential deploy use only the tested integrated candidate with prepared DB.

Full Tutor/Wiki SQL backups, bookmarks and integrity checks were verified privately on Mac. They must never be copied to this repository, GitHub blobs, Library, patches or release artifacts.

1. Verify the exact integrated candidate/bundle and test evidence. Do not push an old source branch.
2. Apply only the reviewed additive Workflow migrations after backup confirmation, against `DB=tutor-db` / `941460fb-c46e-4158-b4a7-5bb468b542ca`, using existing authorized Wrangler:
   - `worker/workflow-migrations/0002-roles.sql`,2976bytes, SHA256 `cc3b60b75450dac929d95703092a76b2ebd371ccabfcb3fcf8e135265b3295a7`.
   - then `worker/workflow-migrations/0003-staged-plans.sql`,4134bytes, SHA256 `ffb153437792e9956b4782c0579d76efb81ce64da7a7372b60b4e79923290cec`.
   Existing0001 is already present. These statements create new tables/triggers; they do not rewrite existing Runs, definitions, settings or ToDo rows. Verify role/stage/epoch schema readiness and unchanged execution state afterward.
3. **No Wiki migration**: WIKI_DB `works-wiki-db` / `a6e45689-9835-4ef5-aa34-06130be32bee` already has0001/0002. **No ToDo SQL migration**: additive JSON metadata retains the existing `todo_state(id,data,revision)` table. Do not run old Wiki recovery SQL or the whole legacy schema as a shortcut.
4. Only after migration success, publish the exact integrated branch once and update PR126 as the combined release. Observe Cloudflare deployment/version after that push; do not launch parallel branch deployments. Require CI for that head before merge. If auto-deploy has already served the integrated candidate, verify it rather than performing a duplicate manual deployment.
5. If needed, the sole coordinator can instruct an authorized Mac deployment of the **same verified candidate** through the existing Wrangler mechanism. Record the actual active version/traffic and verify backend schemas/capabilities read-only. A successful build/check is not deployment proof.
6. Merge only the reviewed combined PR once backend readiness is verified. GitHub Pages has published `main` repository root automatically; observe its deployment and verify static file hashes/versioned assets. Do not simultaneously merge separate source PRs.
7. Refresh the Works connector schema/tools and smoke-read the new dispatch envelope and ToDo metadata. Keep definitions empty and all existing cancelled/completed Runs terminal; do not seed or claim production test work.
8. Parent alone may update only the existing patrol prompt after backend/schema and supported-runtime verification, following `workflow-dot-runner.md`. Preserve schedule, timezone, enabled state and triggers; create no new automation. Actual job activation is not a release smoke test.

## Recovery

Preserve the new tables/history and current execution records. A static rollback is separate from Worker rollback. After new ToDo metadata/clone receipts have been written, retain the forward-compatible serializer/receipt handling in any Worker rollback; the old serializer can discard those fields. Never restore a whole DB over newer work or resume cancelled tasks as part of release recovery.
