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
- [ ] Exact-head backend CI/PR/merge/Worker deployment.
- [ ] Native Library/Tree/Tags, complete metadata/placement controls, binary preview/download.
- [ ] Native uploads/progress and unknown-outcome hold/reconciliation.
- [ ] Full synthetic browser/keyboard/mobile/navigation/teardown and original-source regression.
- [ ] Frontend exact-head CI/PR/merge/Pages deployment.

No real user library operations have been used as tests. Remaining overall modules: admissions calendar/gantt/table/print, native KDP and SS original-column/preferences/detail/print audit. Lesson arbitrary-alias mapping remains read-only pending explicit safe mapping. This is not full Works migration completion.
