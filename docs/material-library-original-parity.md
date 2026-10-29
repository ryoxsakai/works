# Original material-library parity

Baseline `d08ecae292e629ad120a03d52f9a647fe4d8e440`. This is the file/R2 library in `material/`, not the lesson curriculum catalog. Original routes, session/authentication, bindings and stored objects remain available. Source-based inventory; actual iPhone/authenticated live UI and user-attachment pixels remain unverified.

## Exact source inventory

| Source | Original behavior to preserve |
|---|---|
| `material/index.html`, `app.js` 7–118,627–690 | Library/Tree search/Tags tabs, persisted navigation tab, root/folder breadcrumbs, names/code search within the selected folder, direct-child folder/file counts, empty states, new folder and name/code edit dialogs. |
| `app.js` 130–178,426–495 | Type labels/icons, formatted size/date/code, filtered visible count, view/edit/download/delete actions. Name/code are text, not HTML or authority. |
| `app.js` 179–419 | File/folder drag moves into folders/root; folder before/inside/after placement; sibling file/folder ordering. Source cross-parent folder placement is two writes and needs an atomic native replacement. Source folder deletion confirms and rejects nonempty folders; no trash/archive/restore feature. |
| `app.js` 496–626 | Recursive tree, default top-level expansion, subtree/name/code query, open-folder handoff, file preview from tree. Tags are one trimmed material code grouped case-insensitively across all folders, sorted with original locale/numeric semantics; filenames sort within a group. No separate category catalog or multi-tag editor. |
| `app.js` 691–817 | Authenticated binary fetch; literal text/HTML/JS/XML/JSON preview; image/video/audio/PDF browser presentation; unsupported types download locally. Object URLs are revoked. No third-party viewer or file transmission is needed. |
| `app.js` 829–944,1003–1020 | Multiple selection and file drop, queue dedup by name/size/lastModified, remove non-uploading items, explicit sequential Start, progress, per-file success/error. Completed items removed after the batch; another Start retries failed items in original. No active-upload cancellation, whole-library import/export or dedicated print-settings control exists. Unknown-outcome retries require a safer native hold. |
| `worker/src/index.js` 5113–5434,material API routes | Existing MATERIALS_DB/R2 bucket, folders/files/code/order, upload/download/view; guarded single-row edits already exist but source delete/order/create and cross-parent placement lack a complete atomic snapshot. All native operations retain owner browser auth and explicit user intent. |

## Phased publication

1. Add and validate a browser-only `/api/material-library/guarded` metadata endpoint before connecting the native UI. It compares the full observed metadata graph in a materialized SQLite guard and performs each change as one statement. Native cross-parent placement plus sibling ordering is one atomic update; unrelated membership/edit changes reject the whole operation. No new schema/table/credential/permission or data migration. Old endpoints remain backward compatible.
2. Port the original scoped template/controllers and CSS into `/app/`, with shared auth, guarded metadata operations, safe binary preview/download and upload progress. Retain original data/URLs, explicit delete confirmations and unsupported-type download. Freeze editor/drag snapshots; never adopt newer metadata under old input. Add keyboard/mobile alternatives to pointer drag without changing placement semantics.
3. Verify synthetic D1/R2/browser behavior, unknown-result hold/inspection/discard, unsaved queue/forms, teardown, navigation and responsive presentation; publish the tested frontend only after the Worker prerequisite is deployed. No production upload/edit/delete/share or third-party transmission is used for QA.

## Metadata guard semantics

- Allowed operations: folder create/update/delete and file update/delete. Update may atomically set parent/folder and a complete destination sibling order. Names/code limits, duplicate folder names, destination existence, cycle prevention and nonempty deletion checks remain.
- Complete folder/file snapshots include all stored metadata fields and memberships. Maximum2000 rows per kind and1MB HTTP input; oversize/incomplete snapshots stop safely. SQL compares the frozen graph again within the mutation, including changes after validation. The snapshot is a comparison value, not authority from a document.
- Delete file metadata conditionally first, then clean up its exact existing object key. A bucket failure reports `blob_cleanup: uncertain` with the operation receipt; it never restores metadata pointing to an uncertain object, replays deletion, or falsely confirms cleanup. Old objects are not mass rewritten or reassigned.
- Original unguarded routes remain available for backward compatibility; the new endpoint guards native operations and does not claim to retrofit every legacy client's race behavior. Legacy upload and two-store failure semantics need explicit native handling, not inferred success from matching names.

## Current checkpoint

- [x] Original feature inventory and safe split.
- [x] Additive metadata guard implemented without schema changes.
- [x] Synthetic guarded-operation/HTTP auth/CSRF/legacy regression:9 tests pass locally, using isolated D1/R2 only.
- [x] Backend PR152 merged and Worker deployed; exact evidence below.
- [x] Native Library/Tree/Tags, metadata/placement controls and binary preview/download implemented; first synthetic suite passes locally.
- [x] Native explicit sequential uploads/progress and unknown-outcome hold/inspection implemented; first synthetic suite passes.
- [ ] Full synthetic browser/keyboard/mobile/navigation/teardown and original-source regression.
- [ ] Frontend exact-head CI/PR/merge/Pages deployment.

No real user library operations have been used as tests. Remaining overall modules: admissions calendar/gantt/table/print, native KDP and SS original-column/preferences/detail/print audit. Lesson arbitrary-alias mapping remains read-only pending explicit safe mapping. This is not full Works migration completion.

## Published backend prerequisite

PR152: https://github.com/ryoxsakai/works/pull/152 . Tested `dbcddf10b625687045eb48e2ba9f1b71ac3a0100`; merge `9982d38f2d0ba9f36455ac15216c31b4f12b912f`; matching tree `1de0e7db089983cae00fa5c875140dc2a98211f6`. App CI40837089804 and OAuth/Worker CI40837089819 pass. Local complete Worker run186 tests and app102 tests pass. Actual automatic production Worker build7de93ce4-a433-469a-816c-7dfad888f4d2 succeeds with Version `fec29436-8bd8-4a43-a122-d3b7f06ee390`; Pages run40837950725 also succeeds. No manual redeploy or production data operation. The first CI's module-loader incompatibility was fixed using the existing `.js`/lazy-import convention; the Workflow recovery test now waits for its actual busy guard before Reset, retaining all assertions.

## Unpublished native UI checkpoint

The native scoped original controller/template/CSS is implemented on `feat/material-library-original-parity`. Existing auth initializes once, metadata writes freeze original snapshots and validate target/field/object-reference acknowledgements, and keyboard/touch placement uses the same atomic operation as pointer drag. Binary view/download remains local; HTML/JS/XML is literal text. Blob and XHR responses use session/abort fences. Uploads require explicit Start, retain queue progress and halt on any uncertain response without dispatching the remaining queue. The legacy raw upload endpoint does not distinguish all pre-write versus post-write errors, so even raw400 is held rather than assumed safe to retry. A known receipt survives a later refresh failure. Same-name files are never treated as proof of successful upload.

Four new model/context tests pass (106 total app unit tests). The first native browser suite passes using the actual Worker and isolated D1/R2: tabs/search/tags/tree, direct/reloaded folders, create/edit/code/byte preservation, keyboard move/order, explicit delete/nonempty/stale protections, sequential synthetic upload, committed-but-lost response stopping the rest of the queue, no replay during inspect/reset, literal unsafe HTML and local unsupported download, acknowledged-create/failed-refresh recovery, 320/390/768/1440 layout, focus/dirty Back and repeated mounting with one auth initialization. Native390/1440 screenshots were actually inspected. Source button layout/decorative-icon accessibility collisions were corrected.

**Not yet a frontend release.** Remaining before its PR/publication:

- Adapt the existing `services.browser.mjs` Material cases from the reduced viewer to the native implementation; keep admission coverage intact. The full16-suite run has not passed or been claimed.
- Extend native regression for pointer drag/cross-parent placement, all supported media/PDF branches, queue duplicate selection/removal, in-flight responses, abort/auth expiry, late preview fencing, known validation recovery and dark theme.
- Add transport-specific XHR generation/cancellation coverage; review recovery serialization and progress behavior under interleaved events.
- Review legacy raw upload versus concurrent destination deletion and legacy folder-delete race. These old routes are unchanged by the published metadata prerequisite; a safe conditional insert/delete or explicit native hold must prevent orphaned/misleading placement. No schema or ownership inference is needed. Also classify unexpected guarded SQL failures as unknown500 rather than inheriting the old generic400 fallback.
- Rebase/verify against current published main, reproduce built assets, run all relevant Worker/browser regressions, then draft PR, exact-head CI, merge and Pages/Worker verification under existing authorization. No new permission question is required within this scope.

Actual authenticated production UI/iPhone and physical print remain unavailable/unverified; those are QA limits, distinct from the implementation/test items above. No real library file has been uploaded, edited, deleted or shared as a test.
