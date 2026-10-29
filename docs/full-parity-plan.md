# Works complete migration: source contract, checklist and staged handoff

## Goal and baseline

The original Works pages, their fields, structure and interactions are the migration contract. A subset with links to old pages is **not** complete. Preserve the user's current shell preferences (blue/white, Boxicons, logo, desktop sidebar, mobile drawer and five bottom entries), old routes, existing data and permissions. The hidden routine legacy-attribution label is an explicit exception: do not restore it. Do not convert autosave into manual save, or delete controls to simplify the UI, without an explicit product decision.

Source baseline after PR139: `d1bf74ee93625f83a00314ab9048a2563e5ef3d8`. Original pages remain intact. `scripts/full-parity-inventory.py` generates `full-parity-source-inventory.json`: 31 original HTML/JS modules, 430 static controls and 528 interaction/API-call source lines. This is a complete enumeration of those source matches, **not** runtime completeness proof; dynamic templates and interactions must also be tested. Every module below remains open until all its source controls, dynamic controls, behavior and regression tests have evidence. Do not mark a whole module complete because list/detail works.

Two supplied PNG screenshots remain unavailable for pixel comparison: the supported file transfer failed under the cloud network policy and no readable image bytes were obtained. **Their pixels have not been inspected.** Screenshot comparison and visual signoff remain pending permitted access; no alternate transfer path or blocked retry was attempted. Source-based implementation and synthetic browser validation continue independently.

## Milestones (approximately three hours of work each)

These are reviewable work blocks, not a promise that every complex module finishes in one block. Tests may move a dependent step earlier. At each checkpoint record exact branch/commit, completed checklist IDs, test commands/results, blockers and next item. The parent owns scheduled continuation; this branch creates no automation.

| Block | Scope and acceptance gate |
| --- | --- |
| 1, now | Inventory and day-record entry without opaque-ID selection; blur autosave with per-record queue, no lost typing, held/unknown stops; local synthetic tests. |
| 2 | Restore shared memo/next-plan autosave with shared per-name/per-event controllers, existing acknowledgement and conflict guards, correct same-event synchronization across current/next inputs. |
| 3 | Original daily table layout, period counts, prior lesson reference and configured empty slots. Do not mistake archived ownership `previous_record` for a preceding lesson. |
| 4 | Original three lesson tabs and student/group/term navigation; student history table and print selection. |
| 5 | Student goals/schools/profile sections and assigned-material chapter interactions, add/remove/reorder/collapse with existing protections. |
| 6 | Schedule week/list/month/filter interactions, print, date/period navigation and settings panels. |
| 7 | Complete ToDo dialogs, steps, roles/categories, deadlines, sorting/filtering and duplication/recovery. |
| 8 | Complete Memo multi-body/supplements/tags/category CRUD and ordering, including draft/unknown recovery. |
| 9 | Wiki folders, hierarchy, search/pagination and full Markdown editing/source/link workflows. |
| 10 | Wiki proposals, explicit review/adoption, history/diff/restore/export/archive; preserve browser-only confirmations. |
| 11 | Workflow original 1/2/3 steps, wizard, roles, definitions and calendar/agenda/filter/history controls. |
| 12 | Workflow planning/run/task detail, approval/stop/hold/assignment/execution safety and recovery; never dispatch real work for QA. |
| 13 | Material library folders/tree/tags/upload/preview/download/metadata and file lifecycle. Test uploads only with synthetic local fixtures. |
| 14 | Admission original list/calendar/continuous/gantt/table, filters/preferences and print parity. |
| 15 | KDP book/section/source/proposal/history/export workflow, with revision/human decision gates. Split again if required by tests. |
| 16 | SS original table/filter/sort/detail behavior; home/global navigation and all-module regression; screenshot/real-iPhone signoff when available. |

No module is removed from scope when it exceeds a block. Keep remaining controls in the checklist and continue in another block. Old screens are a recovery path during migration, not final parity completion.

## Full functional parity checklist

`[x]` means locally implemented and synthetic-tested in the checkpoint identified below. `[ ]` includes existing partial ports whose **complete** behavior/structure is not yet certified. Original source locations and the JSON inventory are the reference for every group.

### Global / home (`index.html`, `home.js`, `shared/auth.js`, `shared/styles.css`, `prototype/shell-app.mjs`)

- [ ] All nine original module entrances and old/deep URLs, correct current selection and browser Back/Forward/reload.
- [ ] Login/callback/logout/expiry/refresh/cross-tab, existing Google calendar scopes only, private-data cleanup and one shell auth initialization.
- [ ] Original theme preferences, Boxicons/assets/licenses, keyboard/dialog/focus/resize/safe-area/print behaviors for every port.
- [ ] Empty/loading/failure/retry states and single mount/unmount ownership; no duplicate requests or writes across route switches.
- [ ] All original create/edit/remove/export interactions remain discoverable; no extra sharing, credentials or permissions introduced.

### Lesson management (`tutor/index.html`, `tutor/app.js`, `tutor/lesson-plan.js`, `tutor/student-memo.js`)

- [x] L01 Daily eligible lessons expose existing four input values and completion directly; no long identifier or detail click is required to begin.
- [x] L02 Raw calendar/event identifiers are behind optional diagnostic disclosure; composite deep links remain available.
- [x] L03 Current plan/test/homework/lesson memo restore `change`/blur autosave; explicit Save is an additional flush control, not the only persistence path.
- [x] L04 One write in flight per record; further changed fields remain editable, retain focus and queue with the acknowledged record revision. Validation/conflict/unknown outcome never auto-replays.
- [x] L05 Day navigation aggregates child dirty/pending state; pending saves block leaving, unsaved/blocked drafts require discard confirmation, teardown fences queued work.
- [x] L06 Per-day dependent reads are bounded to three; writes bypass queued reads. Same-name/different-calendar records stay separate; held/colliding/changed/unknown records never expose prior content as current.
- [x] L07 Content-sized daily inputs (block 3 restores the original stacked screen layout and seven-column print table), keep 5,000-character current-plan limit and untouched legacy text, preserve safe default print exclusions.
- [x] L08a Original seven-column daily table semantics with stacked screen rows at all widths; immediate current-plan/test/homework/memo inputs and saved-value print table.
- [x] L08b First selected covering term or inclusive ±90-day range, trim-only same-calendar title counts, original period lookup and preceding lesson plan/homework/memo.
- [x] L08c Original calendar colors/name labels and student-name navigation into the native student-information page. Optional composite lesson-detail links remain under diagnostic disclosure.
- [x] L09a Configured excluded titles render empty-slot rows; period labels follow original sorted start times, with JST clock fallback.
- [x] L09b Selected-calendar reads and existing admin/all-day/collision editing gates remain intact. Count matching retains the original trim-only title rules.
- [x] L09c Empty slots show the original calendar name/color when metadata is available; metadata failure is explicit and does not block record entry. Schedule-settings management remains L19.
- [x] L10 Shared student memo immediate textarea/autosave/status/recovery; synchronize all occurrences by exact name, retaining explicit name-sharing acknowledgement and atomic snapshot guard. Do not guess person identity.
- [x] L11 Next-plan immediate textarea/autosave/status/conflict actions and target label. Reuse existing unique-next source/target checks and a shared event store; direct current plan and preceding lesson's next plan must stay synchronized without overwriting dirty input.
- [x] L12a Record / Schedule / Student information page navigation, explicit URL/current-state sync and original `works_active_page_tab` restore at the generic lesson entrance.
- [x] L12b Original name/year/term/group selection state and additive source-reference bookmark restoration; stale source/group and ambiguous cross-calendar restoration require explicit re-selection. Schedule week/month state remains L18.
- [x] L13a Source-based student/group horizontal links, same original annotation/token/group matching functions, selected-calendar scope, explicit term selection, native curriculum table and completion/four-field autosave using composite references and existing guards.
- [x] L13b Functional year/term selection and original state persistence, registered-directory display labels, union of selected terms for choices and explicit source-outside-period carryover. Full original display/print settings modal layout remains L14/L19.
- [x] L13c Deterministic original selection-name profile keys for annotation removal, with explicit context/name, shared-key acknowledgement, canonical source/attribution/revision checks and atomic snapshot CAS. Literal and stripped profiles remain separate; no copy/merge/backfill.
- [ ] L13d Arbitrary restored token/description aliases that equal neither full source title nor its deterministic original selection name remain read-only for profiles. Add an explicit, separately guarded mapping workflow rather than guessing identity.
- [x] L14 Original optional print name/blank fallback (guarded acknowledged blur save plus explicit Save), shared original per-section print/collapse preferences, saved memo opt-in, goals/schools/material/curriculum print, name/year/term heading, multiline saved values, repeated table headers and page-break handling. Physical printer/iPhone QA remains unverified.
- [x] L15 Short/mid/long goals: completion, create/edit/delete/order, original shared-template CRUD/order/copy, modal cancel/close and keyboard controls (synthetic API/browser verified).
- [x] L16 Original 31 private medical schools, national/public free text, explicit removal, nullable first/second/third preferences and summary; atomic rank changes. Admission information/settings beyond these original student controls remain L19.
- [x] L17 Assigned materials: categorized add/remove retaining progress, immediate guarded single-chapter completion, per-material collapse, native drag/450ms touch reorder and keyboard up/down alternatives, empty states. API, button/native-drag and synthetic long-press touch reordering verified; real-device touch fidelity remains QA-pending.
- [x] L18 Original Monday week/day-selector list and Sunday-first month calendar, independent week/month cursors in URL, name+description filter/reset, original view preference, calendar labels/colors, selected-term union/gaps or ±90-day scope, list-only empty slots, eligible student/record links and active-view print. Guarded details never show held/colliding/stale records.
- [ ] L19 Settings tabs: selected calendars, excluded titles, terms/years, periods, slots, curriculum materials/categories/chapters, appearance. Original validation/CRUD/order and modal accessibility.
- [ ] L20 Attribution resolution/history remains available behind necessary conflict UI, explicit inherit/separate preserves archives and ownership; baseline initialization/resume/holds unchanged. Hidden routine legacy label stays hidden.

Block 2 now restores immediate shared-memo and next-plan blur autosave, using the original exact name/composite-event identity and frozen per-change intents. The existing explicit shared-name acknowledgement is retained before memo autosave. Print-name/progress remain separate guarded operations. This does **not** certify original table layout, counts, preceding references or the full student-information screen; those items remain open.

### ToDo (`todo/index.html`, `todo/todo.js`)

- [ ] Original dashboard/group/card/detail structure, status/progress/priority/deadline/category/role fields and defaults.
- [ ] Create/edit/archive/delete/completion and all steps/checklists with original modal/back/cancel/focus behavior.
- [ ] Role and category management, ordering, assignment and any owner confirmation conditions.
- [ ] Search/filter/sort/group visibility and persistence; mobile interactions and remaining-day display.
- [ ] Duplicate/clone date preview and confirmation, pending-operation recovery/export, revision conflicts, preserved unrelated fields/receipts.

### Memo (`memo/index.html`, `memo/app.js`)

- [ ] Original list/cards/modal entry, create/edit/remove and default fields.
- [ ] Multiple bodies, supplementary notes, add/remove/reorder, tags and category selection/management/order.
- [ ] Search/filter/sort, expansion/display preferences and keyboard/cancel behavior.
- [ ] Whole-document CAS, draft export/recovery, unknown write result and no duplicate saves; retain other memos exactly.

### Wiki (`wiki/index.html`, `wiki/app.js`, `wiki/folders.js`, `wiki/hierarchy.mjs`, `wiki/review.js`, `wiki/markdown.js`)

- [ ] Folder create/rename/move and hierarchy/tree/list/breadcrumb/pagination/search.
- [ ] Page create/edit/move/archive, original metadata/tags, Markdown editing and safe preview/split controls.
- [ ] Source add/edit/remove and related-page links; reading-focus mode and navigation state.
- [ ] Proposal creation, explicit review/diff/adopt/reject with original browser-only gates.
- [ ] History pagination/comparison/restore, Markdown/JSON export and stale revision recovery.
- [ ] Untrusted Markdown/source/proposal text remains data; sanitize links/HTML and preserve execution/permission boundaries.

### Workflow (`workflow/index.html`, `workflow/app.js`, `workflow/roles.*`, `workflow/planning.mjs`, `workflow/steps.mjs`, `workflow/dialogs.mjs`)

- [ ] Original three numbered steps, wizard back/next/cancel/resume and empty state.
- [ ] Roles create/edit/order/archive, allowed assignments and existing role lifecycle restrictions.
- [ ] Definitions/task structure, drafts/versioning/sources, human confirmation and execution authorization.
- [ ] Kanban/calendar/agenda, day/today/previous/next, responsive day range, text/status filters and persisted selection.
- [ ] Confirmation panel independent of board filters; pending/overdue/running/review information and original actions.
- [ ] Run/task detail, artifacts/receipts/logs, stop/pause/hold/approval/reassignment and history scope.
- [ ] Planning/rolling/future-slot details and settings/status dialogs; no real claims/dispatches or automatic permission changes for tests.
- [ ] Unknown outcomes, leases/ownership, terminal states and original retry/reconciliation gates preserved end to end.

### Material library (`material/index.html`, `material/app.js`)

- [ ] Original Library / Tree search / Tags tabs, folder breadcrumbs and selected-folder searches.
- [ ] Folder create/rename/move/delete and file metadata/code/classification/tag editing with original validation.
- [ ] Multiple-file selection, upload queue/start/progress/cancel/failure/retry and duplicate handling.
- [ ] File preview/open/download, original safe URLs and browser defaults; file move/reorder/delete with confirmation.
- [ ] Nested hierarchy/cycle protection, tree/tag search and expansion/state persistence; preserve existing R2 objects and links.

### Admission (`admission/index.html`, `admission/app.js`, `admission/admission.js`)

- [ ] Original list/month calendar/continuous calendar/gantt/table views and date navigation.
- [ ] University aliases, selection type/stage/month filters, search, select all/clear and preference persistence.
- [ ] Dates/ranges/remaining-day/colors/source links and row/university summaries.
- [ ] Active-view printing, printable gantt/table and cleanup; empty/error states. Preserve registered source records and existing editor/API semantics.

### KDP (`kdp/index.html`, `kdp/app.js`)

- [ ] Books and section hierarchy create/edit/order/archive as supported by the original controls.
- [ ] Section text/metadata editing, navigation and unsaved/back/cancel behavior.
- [ ] Sources, proposal generation/submission, explicit accept/reject and immutable revision checks.
- [ ] History/diff/recovery, reference details and every original export action.
- [ ] Preserve browser ownership and separate write/human approval requirements; no accepting proposals or creating real books for tests.

### SS (`ss/index.html`, `ss/app.js`)

- [ ] Original table columns (project/status/deadline/remaining), sort-key/direction/column-button behavior and preference storage.
- [ ] Completed visibility/counts and full original project memo/details; correct empty/failure/mobile/print behavior.
- [ ] Preserve the original read-only browser contract; do not invent new editing flows to replace original behavior.

## Test and release gates

Each migrated interaction needs a synthetic state/default/action test and recovery tests when it writes. Use original source to establish autosave triggers, not a redesigned subset. For current/next/shared data test duplicate names, same calendar/event collisions, recurring instances, moved times, held legacy records, same-title replacement, racing edits and lost responses. Compare source controls against the JSON inventory before marking a feature group done. Do not broaden testing endlessly after the relevant gates pass; advance the next open group.

Always keep normal/empty/error/held cases, keyboard/focus, real input height, 320/390/768/desktop width, print, Back/Forward/reload and repeated mount/unmount in the regression set. Screenshot-dependent claims await the actual two supplied images. No live production saves, schedule writes, claims, deletes, sharing, scopes or grants are test fixtures.

The migration now has its own publication authorization for tested phases; it does not rely on prior PR139 permission. Push/draft PR/merge/deploy status must be reported explicitly; no PR approval review on the user's behalf. No production data migration is part of these blocks.

## Block 1 verified checkpoint

This plan supersedes the manual-save-only interim choice documented for PR139 in `app-teaching-form-parity.md`. Current record blur autosave is restored here; shared memo and linked next-plan autosave are explicitly pending block 2, with no weakening of their guarded APIs.

- `npm --prefix prototype test`: 30 passed (includes bounded-read queue, abort/no-dispatch and write-priority checks).
- `node --test tutor/test/*.test.mjs worker/test/lesson-plan.test.mjs worker/test/teaching-linked.test.mjs`: 74 passed.
- `BROWSER_EXECUTABLE=/usr/bin/chromium npm --prefix prototype run test:browser`: all eight suites passed with the day-inline/autosave implementation.
- Focused teaching suite additionally passed after adding a pre-existing 7,000-character plan case and a calendar-title change between read and blur-save. Untouched long plan retained, other-field patch omitted the plan; changed target stopped saving/read-back disclosure.
- `npm --prefix prototype run build:app` generated the tracked app assets; `git diff --check` passed. No Worker source, schema, production records or permission settings changed.
- Synthetic desktop/mobile screenshots and print output were generated internally and inspected. They are evidence of this source-based increment, **not** comparison against the inaccessible supplied screenshots or real iPhone QA.

At the end of block 1 the next task was block 2's shared stores and immediate memo/next controls; that work is now implemented below. The next implementation target is block 3's original table/term/prior-reference behavior. Keep the explicit image-access blocker open and avoid declaring the whole lesson module or any other module fully migrated.


## Block 2 implementation checkpoint

- A root-lifetime `teaching-store.mjs` now owns one exact-name memo draft and one composite calendar/event record draft per destination. Inputs in daily/current/next views share values and acknowledged revisions. Unmount/expiry discards private session state and prevents queued dispatch.
- Each blur intent freezes its own values, target/source and source epoch. A queued valid direct-plan intent cannot borrow a later draft originating in a stale next-link context. Memo intents similarly retain their initiating lesson and full expected profile snapshot, including pending reversions to the old value.
- Current-plan and linked-next-plan writes use the existing expected-plan API. Other record fields retain their original separate row-save channel; changing homework cannot silently persist an unblurred linked plan. Both channels serialize on the same destination revision.
- Shared memo is immediately editable; name-sharing acknowledgement is session-local and required before blur autosave. Exact-name copies update together, including while a save is pending. Trim/blank normalization follows the original memo store, with full-snapshot CAS retained. No person identity is guessed or moved.
- Unknown outcomes and conflicts retain all drafts and block replay. A stale next target can only be rebound after explicit shared-draft discard and a fresh preview plus canonical record read. The old input is never copied to a new candidate. Source failures stop dependent writes; unrelated acknowledged fields remain intact.
- Explicit discard/reload locks affected input copies until the read completes, refuses an older record revision and never consumes text entered after the discard confirmation. UI only commits user-originated changes, not mirrored programmatic updates.
- Print-name edits lock the shared profile while retaining the memo and existing confirmation; assigned progress retains its guarded snapshot and limits. Saved next-plan printing excludes unknown/held outcomes and student memo remains excluded by default.

Validation for this batch: 45 local unit tests (including per-intent source/value isolation, partial source failure, queued reversion, revision monotonicity and reload locks); 74 Tutor/next-plan/guarded API regression tests. All eight browser suites passed on the final implementation; reproducible app build and diff checks also passed. Browser scenarios include same-name copies across calendars, interleaved current/next edits, pending typing, 409/unknown committed writes, read-back, explicit newly earlier next-candidate selection, preserved old target data, profile/progress isolation, mobile/keyboard/print and repeated navigation.

No Worker/API/schema changes, real production saves, new scopes, automation or publication were introduced. Supplied screenshot pixels remain inaccessible and unverified; no transfer retry was attempted in block 2. Original table layout/period counts/previous lesson references and the later module checklist are still pending. Publication approval remains pending; this batch is local only.


## Block 3 implementation checkpoint

The daily entry now follows the original `tutor/app.js` `loadRecordTable` and `shared/styles.css` record-stack contract: seven semantic columns for print, student above count/time and four full-width inputs on **all screen widths**. It does not invent a desktop four-column form. Existing native external form-associated controls use the same shared autosave coordinator and per-origin intent guards. Printing uses acknowledged field snapshots, preserves the optional print name, and excludes private student memo and unavailable content.

`teaching-history.mjs` mirrors the first selected covering term in API order (strict ID equality), inclusive JST end date and otherwise 181 civil days (±90). Counts match exact trimmed full titles in the same calendar; annotation/NFKC equivalence is deliberately not borrowed from next-plan matching. Original counting includes same-title all-day events unless explicitly excluded; the existing stricter editing eligibility remains a safety exception. Period labels sort by start time, ignoring display order. Configured excluded titles appear as empty slots without exposing their title; calendar label is currently the original fallback until calendar metadata is ported.

Preceding reference means the preceding calendar event in that range, **never** an archived ownership `previous_record`. Only canonical, attributed, acknowledged plan/homework/memo is shown. Cross-calendar ID collisions, repeated IDs, changed day/range references and ambiguous same-time candidates suppress selection or reference display. Fresh moved-time reads reorder the original event identity. Metadata failures show unknown counts and a separate read-only retry while existing lesson inputs remain usable. Empty days avoid unnecessary metadata/range requests. Preceding-record reads use a separate read-only snapshot and never seed or unlock the shared editing store; refreshing references cannot clear a 409/unknown stop or replace a draft. Existing shared acknowledged values take precedence when available. Reads remain session/abort fenced, paginated and bounded; no writes or new API/schema are introduced.

At the historical block 3 checkpoint, calendar names/colors and original student-information navigation (L08c/L09c) were still pending; block 4 below completes those entrances. Optional lesson detail remains available separately. All later lesson tabs, student/material/settings controls and other module checklist items remain open. Supplied screenshot pixel comparison and real iPhone validation remain pending; source-based synthetic screenshots are not evidence that supplied images were viewed. Publication approval remains pending; no push, PR, merge or deployment.

Block 3 regression coverage includes date/term endpoints and overlap order, leap-day fallback, strict term ID types, trim-only titles, all-day counting/exclusion, same-name separate calendars, moved and duplicate event IDs, ambiguous prior timestamps, period start order, authenticated multi-calendar range bounds, read-only metadata routes, metadata failure/retry, held/wrong-target/archived prior content suppression, reference refresh retaining conflict stops, original stacked widths (320/390/768/1440), native seven-column print rows and acknowledged-value printing during an in-flight save.

Final block 3 validation: `npm --prefix prototype test` — 52/52 passed; `node --test tutor/test/*.test.mjs worker/test/lesson-plan.test.mjs worker/test/teaching-linked.test.mjs` — 74/74 passed; all eight `test:browser` suites passed on the final implementation, including a focused lesson rerun before the full run. Static app rebuild is reproducible and `git diff --check` passes. Earlier regression failures identified a stale old-screen hint assertion and the reference-read/shared-store interaction; both are corrected and the final run is green.


## Block 4 implementation checkpoint

`teaching-workspace.mjs` owns the original three page entrances around the record module. Record/day and existing composite routes remain supported; student and schedule routes are native Framework7 routes. Explicit numeric term query parameters survive reload and Back/Forward. Generic lesson entry restores the existing original tab preference; this does not yet restore the full original curriculum name/year/term selection. Source calendar/event references are resolved against freshly read selected calendars and the chosen period before displaying editing controls. Missing, deleted or out-of-range sources require re-selection and never reuse a preceding person's data.

Calendar list reads reuse existing Google authentication/scopes, paginate and are abort/session fenced. Appearance follows the original seven-color fallback palette and 72% white mixing, with hex validation to reject CSS injection. Labels accompany decorative color. Calendar metadata failure remains visible and record entry stays usable. Student selector groups use original calendar-name/kind rules; if metadata fails, each selected calendar receives a separate explicitly unverified numbered label, so unknown calendars cannot collapse into a common “その他” group.

The student page includes source/group horizontal selectors, selected term filtering, the original 720px horizontally scrollable seven-column curriculum table, completion and four text fields. Row autosave reuses the same per-calendar/event coordinator and source attribution/CAS checks. Annotation stripping, exact token/phrase matching and group-title functions are copied from the original source and compared literally in tests. Same-name records in distinct calendar groups stay separate; no name normalization is used to move ownership or student profile data. Guarded memo/print-name/progress panels are available only when the original selection name exactly equals the source title's name key. Annotation-key mismatches are explained and remain pending safe profile-key support rather than silently using or copying another key.

Manual linked editors lock curriculum row controls while active. Unknown/conflict stops require explicit reload/discard; normal/background store seeds cannot clear a stopped record, including a clean stopped draft. Confirmed discard refreshes the existing form in place rather than launching a second record load that can race immediate subsequent input. The native student print heading uses the guarded print name; private memo remains excluded and fields print acknowledged values.

The schedule entrance currently provides selected-day event reading with calendar labels/colors and student/record links. It explicitly lists week/month, name filtering and schedule print as not yet migrated. Student goals, schools, full assigned-material actions, year/selection settings and full print controls remain in the later checklist. Original pages, URLs, content, API schema and permissions are intact; no Worker or database changes, production test saves, new dependencies, publication or image-transfer retry occur in this checkpoint.


Block 4 validation: 59/59 unit tests; 74/74 Tutor, next-plan and guarded API regression tests; all eight browser suites passed, followed by a passing focused lesson rerun after the final curriculum date/heading adjustments and added keyboard/tab-resume/annotation-key tests. Student dates retain the original `MM/DD (weekday) period` presentation, consistently pinned to JST with the shell's date routing. Browser coverage includes term/URL reload and history, source missing/held, same-name calendar separation, metadata failure with per-calendar fallback groups, curriculum autosave, conflict navigation cancellation/discard, linked-editor row locks, 390px horizontal table scrolling, print-name/private-memo behavior, keyboard Enter/focus and original tab preference restore. Supplied screenshot transfer remains blocked and was not retried; real-iPhone and full screenshot parity remain unverified. Remote main was read-only rechecked and remains `d1bf74ee93625f83a00314ab9048a2563e5ef3d8`. No publication operation was attempted; approval is pending.

Next coherent work: finish L13b/L13c (original selection/year/term state and safely guarded annotation-name profile keys), then original goals/schools and assigned-material actions in source order. Keep L18 schedule week/month and original settings/print controls explicitly open; do not declare the lesson module fully migrated.


## Block 5 implementation checkpoint and release contract

The original `works_curriculum_state` name/year/term/group fields are restored and saved unchanged in shape. A separate local-only `works_app_curriculum_source` bookmark stores the source calendar/event reference and selection snapshot, never memo/content. Explicit URLs override remembered periods; generic entry restores valid selections. Explicit deleted/deselected or mismatched year/term URLs fail visibly. Remembered invalid terms realign to currently configured terms as the original settings do; source identity is independently revalidated. The original no-term initial state is retained when no active term or saved selection exists. Changing year clears the term until the explicit display action; a blank term leaves curriculum history empty while independently guarded student information remains available.

Selector choices use the union of configured active terms, or the original recent ±90-day area when none are selected. Reads use inclusive JST civil-day bounds rather than discarding boundary hours. The original raw-ISO date-prefix term-membership rule and literal/token matching are retained. Curriculum data is separately scoped to the chosen term; an explicit or bookmarked source outside that period is revalidated by its ID, never by time or a similar name. Conflicting overlapping calendar reads stop rather than choose a stale variant. Friendly registered-directory labels do not replace the stored profile key. Old literal/full-title selections are retained as separate keys. Missing/renamed bookmarks, unavailable old groups and legacy same-name multiple-calendar ambiguity require explicit re-selection; no automatic move to another group's same-name student occurs.

`shared/student-profile-key.js` contains the original deterministic group-title/annotation-removal functions, verified against Tutor source. Guarded profile/progress APIs now accept an **optional** `profile_context=curriculum` plus the exact computed name. The server derives and checks that key from the fresh canonical source itself; it accepts no arbitrary alias. Existing callers retain full-title semantics and response shape. Reads/writes still require browser authentication, selected/eligible/current attributed source, unchanged canonical target/revision, explicit shared-name acknowledgement and complete profile/assignment snapshots. Literal and stripped profiles/material progress are never merged, copied, deleted or marked verified. Concurrent plain/annotation contexts contend on the same atomic key snapshot when they intentionally address that same existing key.

Client memo queues freeze each intent's source, epoch and binding; a late edit cannot borrow another key/context. Shared state remains keyed by actual storage name, so a plain title and annotated title intentionally using the same original key share one queue, while literal and stripped keys remain separate. Ordinary reads cannot clear unknown/conflict stops. Those stops also retain navigation protection after a user reverts text to an older displayed value; only explicit discard/reload acknowledges them.

Publication is now authorized for the migration's tested phases. This release contains blocks 1–5, not a declaration of full Works parity. No database/schema migration, profile-name backfill, production test saves, automation changes, new dependencies, scopes or credentials are needed. Deploy the additive Worker support before Pages when tooling permits. If Pages arrives first, annotated-name profile reads reject an old response's mismatched name/context, leaving those controls unavailable; writes have no fallback to legacy unguarded APIs. Existing full-title requests remain compatible in either order. Verify both deployment revisions before calling the feature published. Authenticated production data editing is not a release test.

Next phase: goals and desired-school interactions, then complete assigned-material actions, using the same resolved original key and source context. Their existing legacy CRUD endpoints lack the guarded snapshots used here, so native write controls must gain corresponding source/CAS protection rather than bypass this foundation. Original display/print settings, arbitrary legacy aliases and schedule week/month controls remain explicitly open. Supplied screenshot pixels and real-iPhone QA are still unavailable; the blocked image transfer was not retried.


Block 5 local validation: 66/66 unit tests; Worker full suite 162/162 before the final additional CAS-race test, then related guarded API suite 14/14 including that added test; Tutor 48/48; all eight app browser suites passed on the current implementation. Wrangler deploy **dry-run** and diff checks passed. Browser cases include year/term apply and generic-entry restoration, original no-term behavior, selected-term union/source carryover, renamed bookmark refusal, annotation-key autosave preserving the literal profile, old-Worker mismatched response rejection, and conflict navigation protection even when text was reverted to an older value.

Release preparation: API-only draft PR [#140](https://github.com/ryoxsakai/works/pull/140), head `cf536c86df15de28b961a2ab46cddc239aa08dd0`, branch `fix/lesson-profile-selection-key`. It contains only the optional guarded key support, shared pure name-key helper and synthetic API tests. It targets current main explicitly. Worker CI/deployment precede the subsequent frontend PR; no production deployment has been claimed at this preparation checkpoint. Existing automatic main Worker build integration was read-only verified from main's successful check, without requesting credentials or manually deploying.


API prerequisite published: PR #140 tested head `6b56b2591ead6a124146e8d96a859385d91c719e`, CI `40803687770` succeeded, merged as `c369540b54c29ca9ca37c763322b6f4a6fc5c921`. Its tree matches the tested head exactly. The automatic Cloudflare production check succeeded with Worker version `ab228240-1529-46bf-8072-141eb89723ab` (build `712d1839-fc20-411c-8128-7654cea66e31`). No manual deploy or production test save was used. The frontend was rebased onto that main; its tree stayed identical, and all 66 unit tests passed again. Initial CI Memo failure was a reproducible delayed-focus test race; the test now waits for the original modal focus transition while retaining the same content assertions.


## Goals, schools and assigned materials checkpoint (2026-10-29)

Original source comparison: `tutor/app.js` goal/template controls (2689–3050), schools (3055–3260; original private-school catalog at 75–110), and assigned materials (1710–1930). The shared catalog is copied without changing the original list. The student page keeps its memo, original curriculum table and adjacent goal/school/material sections. Modal changes save individually, matching original control semantics; original routes remain available.

The additive browser-session-only `/api/student-planning/guarded` endpoint checks the fresh calendar source, attribution, deterministic original name key, source revision, explicit shared-key acknowledgement and the complete previous resource snapshot inside the existing D1 transaction guard. Reordering and clearing/setting school ranks are atomic. Shared-template changes require a second global acknowledgement; copying checks the exact template snapshot. Removing a material deletes only its assignment and retains chapter progress. Legacy CRUD endpoints and schemas are unchanged; no migration or production data rewrite is required. Deploy the backward-compatible API before the new frontend.

The UI retains newer text typed while a save is in flight, blocks duplicate writes and cross-panel edits, preserves failed drafts and never automatically retries a conflict or unknown result. Read-only inspection does not unlock writes; explicit discard/reload is required. Native dialogs preserve focus/scroll and dirty-close confirmation. Accessible arrows supplement original drag/touch interaction. Print material output uses acknowledged data rather than optimistic checkbox/order drafts.

Synthetic verification includes three planning-store tests; eight real D1 API tests covering identity boundaries, concurrent writers, list CAS, template snapshots, atomic ranks and progress retention; and a browser suite using the real new API against isolated synthetic D1. Browser coverage includes in-flight newer drafts, shared acknowledgements, actual CRUD/order, unknown committed-result recovery without replay, Escape/focus, widths 320/390/768/1440 and saved material print output. Full regression terminal results and publication evidence are recorded with the release.

Remaining: L14 complete original print settings and section selection; L18 weekly/monthly schedule/filter/print; L19 original settings/catalog operations; arbitrary saved-name aliases remain read-only until a safe explicit mapping exists (L13d). Screenshot pixel comparison and real-iPhone/physical touch QA remain unavailable, and no production test saves are used. This is not a claim of full migration completion.


## Schedule and print parity phase (2026-10-29)

Source comparison: Tutor `loadCalendarEvents` / `getFilteredEvents` / `renderScheduleWeekDays` / `renderListView` / `renderCalendarView` and navigation handlers at 3299–3618; original `works_event_view`, `works_print_sections`, `works_collapsed_sections` settings; original print controls and CSS in `shared/styles.css`. The original weekly interaction is a Monday-first seven-day selector with one selected day's list, not a replacement week grid. Month cells start Sunday, omit excluded empty slots, retain all-day events, use original calendar accents and navigate to source-based student information. The list keeps excluded entries as small “空き” cards and shows acknowledged plan/homework/memo with preserved newlines.

Schedule fetches the selected-term union (gaps are excluded) or the original ±90-day range, using selected calendars, existing pagination and a bounded read queue. Only eligible visible-day records are read; duplicate cross-calendar event IDs and invalid/held/changed records cannot expose saved content as confirmed. Week/month/date/filter state is URL-backed for direct links, reload and Back/Forward; the original view preference is shared. Civil dates are explicitly JST, matching the rest of lesson routing even when the device timezone differs. No new dependency, API, migration or production data test write is needed.

Student print settings retain original defaults (memo excluded; goals, schools, curriculum and materials included), shared local preference keys, screen collapse independent of print inclusion, and native-dialog focus/Escape behavior. The title uses acknowledged optional print name or selection-name fallback plus year/term labels. Print-name blur save requires the existing shared-name acknowledgement and exact profile CAS; conflicts/unknown results retain the draft and stop. Print controls wait for complete safe resource reads and all pending/draft edits. Native print output uses acknowledged snapshots, including optional memo and material completion, expands selected collapsed sections and retains repeated curriculum headers.

Verification covers civil-date/leap/year boundaries, union/gap filtering, description search, original defaults/corrupt storage, real integrated route navigation/reload/Back, print settings/collapse/focus, guarded print-name blur save and a dedicated schedule browser fixture for empty slots, all-day, held/collision privacy, multiline records, bounded reads, responsive month scrolling and print. Full regression/CI/deployment evidence accompanies the release. Actual iPhone/physical printer QA and attachment-pixel comparison remain explicitly unverified.

### Remaining full-application migration audit

| Module | Remaining original parity work (not certified complete by this release) |
|---|---|
| Lesson management | L13d arbitrary saved aliases need an explicit guarded mapping; L19 calendar/exclusion/year/term/period/slot and material catalog settings; L20 native explicit attribution resolution/history remains through old-screen conflict routes. |
| ToDo | Original dashboard/group/card layout, all fields/checklists and lifecycle actions, category/role management, clone preview, preferences and operation recovery; use the detailed unchecked list above. |
| Memo | Original multi-body/supplementary editor, tags/category operations, reorder/display/search preferences and complete lifecycle/recovery. |
| Wiki | Folder hierarchy CRUD/move, full page/source/proposal/history/review/export controls and reading/preview modes. |
| Workflow | Full original role/definition/task/run controls, calendar/agenda and confirmation/history/settings/planning dialogs; all existing authorization/stop/lease gates remain required. |
| Material library | Original tree/tags tabs, folder/file lifecycle and classification, multi-file upload/retry/cancel, preview/download/move/delete and expansion preferences. |
| Admission | All original calendar/continuous/gantt/table views, filters/selection preferences, summaries and active-view print/export. |
| KDP | Still a clearly marked original-screen route; full native books/sections/sources/proposals/history/export migration remains. |
| SS | Existing integrated read-only browser remains; original table columns/sort/preference and complete detail/print field-by-field audit remains unchecked. |
| Common shell | Existing logo/Boxicons/desktop sidebar/mobile drawer and five bottom items preserved; final complete-original interaction audit and real-iPhone QA remain. |

Next coherent implementation: L19 original settings/catalog operations with corresponding source/CAS guards where student-scoped, then continue the non-lesson lists in original feature order. No remaining item is silently replaced by a simplified feature.


Release regression: the first CI run detected an interrupted mobile drawer transition leaving the backdrop after accessibility/background locks had been released. The controller now removes an orphaned owned backdrop when genuinely closed and ignores a stale close notification while a new opening is active. Deterministic regressions cover both states in addition to the original rapid open/backdrop/Escape/resize loops. The first CI run was not retried blindly; the final code is revalidated at a new exact head. Local Chrome 153 download was blocked by the cloud network policy (HTTP 403 Domain forbidden), so no alternate download path was attempted; local Chrome 151 and the existing GitHub CI browser are the verification paths.
