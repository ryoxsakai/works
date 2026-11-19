# Calendar title changes: prospective baseline rollout

Approved behavior starts with lessons dated **2026-10-27 in Asia/Tokyo**. Existing records remain available. A baseline is a current Calendar title observed for future comparison; it is never evidence of the historical student's identity. No production database/calendar access, migration, deployment, push, credential lookup, or automation change was performed during implementation.

## Record behavior

- Existing content with no saved identity is returned as `legacy_historical` before the effective lesson date and `legacy_unverified` on/after it. The UI labels these **旧記録・所属未確認**. Plans, tests, homework, memo and stored completion remain available, including to existing schedule/notification APIs, with attribution status and notice.
- On/after the effective date, an authoritative selected-calendar read or first edit observes the event title/calendar, exact instance ID, event start, etag, effective date and actual UTC observation time. The original record is copied into an immutable source table in the same guarded transaction. `curriculum_entries` is not rewritten by observation, and the confirmed identity title stays NULL.
- Historical edits retain an immutable pre-edit source and remain unverified; they do not create a future baseline. Editing one inherited field never confirms the other old fields.
- A meaningful future change against an observed or explicitly confirmed title hides the old record from the current lesson view and blocks saving until an explicit choice. Only NFKC and repeated/outer whitespace are cosmetic. Time moves with the same ID retain content; each recurring instance is independent. Duplicate names do not merge records. An identical-title replacement cannot be detected by title comparison; the record/history action remains available for manual separation.
- Explicit **same student's name correction/inherit** archives the prior snapshot and confirms the chosen current title; **different student's replacement/separate** archives the prior snapshot and starts an empty active record. The immutable original source remains available in the review. Profile memo, print name, materials and other name-keyed student data are never moved.
- Known already-renamed instances must be privately held before activation. They are never observed or adopted automatically, even if they have no stored content. The owner must explicitly resolve them. Ordinary unheld empty placeholders remain usable without review.

A known-change hold is separate from ownership. Its exact calendar/event ID is deployment data, not repository code. The private activation file prepared for the specifically identified instance contains no old/new student names. No decision about which student's old content belongs to whom has been made.

## Initial observation and coverage boundary

The effective date filters **lesson dates in JST**, not the capture time. A title observation cannot reconstruct a rename that occurred before it. Therefore the publication procedure includes an initial controlled sweep after installing holds, rather than waiting for each lesson's first visit.

The authenticated browser action **設定 → カレンダー → 初回の比較用予定名を準備** calls `POST /api/lesson-baseline/initialize` in resumable pages of at most 25 existing records. It checks selected calendars, uses authoritative event instances, observes only on/after the configured date, skips historical records, preserves known holds, and reports unavailable/colliding records separately. The page cursor can be replayed safely; existing observations and user-resolved holds are not overwritten. The action uses the existing browser session and existing Worker Calendar connection; no new credential is required.

Finish this sweep before declaring coverage live. Resolve unavailable/ambiguous cases as a coverage exception; the UI reports partial completion instead of claiming success for them. Calendar is external, so this is an observation pass with per-record timestamps, not an atomic historical snapshot of all calendars at midnight. Unknown changes before the first successful observation remain unknowable. Subsequent reads/edits can observe newly encountered legacy records, always without confirming ownership.

## API, notifications and aggregates

Schedule, search, briefing, student overview, curriculum progress and monthly-report reads preserve the available legacy fields and return explicit attribution status/notice. Previous-lesson briefing also matches calendar as well as title. The next-lesson service retains normalized-title/calendar matching, ambiguity rejection, destination/source rechecks and conflict protections. Unverified linked plans are labeled in the UI and remain unverified on save.

No blanket quarantine occurs. Only known holds, detected changes, ID collisions and unavailable stale targets are masked. Notifications can continue receiving old plans as **unverified legacy content**; they must not describe that status as ownership confirmation. Specifically held/changed records return no old plan as a current plan. Existing sent notifications and external caches cannot be recalled by this change. No automation schedule or prompt was changed.

Definite unresolved records are separated from unrecorded/past-due counts and missing-field lists. Rates affected by unresolved elapsed attribution are NULL. Preserved legacy counts/rates remain available but include `legacy_unverified` counts, `ownership_verified=false` and `data_complete=false`, so available historical numbers do not imply verified attribution.

`POST /api/lesson-records` observes eligible targets using authoritative Calendar lookups and returns metadata for the browser's shared comparison. Large frontend batches retain collision/unavailable masks across chunks. List cards, daily records, previous snippets and curriculum tables use the same comparison. A cancelled/unavailable target affects its own row; it does not erase unrelated rows. Authentication/upstream failures remain errors.

The raw opt-in feed `GET /api/curriculum?attribution=1` is explicitly unverified; consumers must compare identities/baselines before presenting it. The legacy unversioned feed masks content because old clients cannot perform that comparison; old writes without a fresh event reference and revision return 409 and require a refresh. The paired new tutor frontend must be deployed for the approved legacy-preserving UI behavior.

## Preservation, concurrency and collisions

Observation/source capture, normal updates, attribution decisions and undo use D1 batches and revision guards. Triggers advance revisions for raw legacy writers too. First writes also initialize any required observation before editing. Source snapshots are insert-only; explicit decisions archive every previous active snapshot, including its unknown attribution and comparison value. Empty known identities are archived when rebound. No original record is assigned a guessed historical owner.

Read-after-write responses check exact committed revision and archive generation, so a same-title replacement cannot leak into the original caller's success response. If a later change wins before response reading, the response states that the save committed and was subsequently changed, preserves the draft and requires reload. Stale-write conflict payloads withhold the newer plan. Undo validates the current target, attribution metadata and history generation, preserving legacy/unverified status rather than confirming it.

The active legacy table still has one row per event ID. Browser and MCP writes therefore refuse collisions across all selected calendars, even when a caller explicitly supplies a calendar or uses date/title. Observation has the same selected-calendar collision guard. Colliding instances require calendar-level reconciliation; they cannot have two independently editable active records under one ID. Unselected calendars are outside the configured scope.

## Additive migration and exact publication sequence

1. Back up D1, including curriculum entries, existing change history and any already-present attribution tables. Record counts/content checksums. Do not backfill owner names from current titles.
2. Apply only `worker/migrations/lesson-record-attribution.sql`. It adds seven tables (`lesson_record_identity`, `lesson_record_archive`, `lesson_record_guard`, `lesson_record_baseline`, `lesson_record_legacy_source`, `lesson_record_hold`, `lesson_record_policy`), one archive index and three revision triggers. It performs no lesson-record UPDATE/DELETE, title backfill, owner confirmation or initial observation.
3. Apply the **private** activation SQL. It first disables new observations, installs the exact known-change hold(s), then enables policy only if effective date/count match and all exact holds exist. The prepared effective date is 2026-10-27. Files are outside the repository: `/tmp/works-lesson-attribution-private-config.json` and `/tmp/works-lesson-attribution-private-activation.sql`. They were generated offline, not applied. Generic generator: `node worker/scripts/prepare-lesson-attribution-config.mjs PRIVATE_JSON PRIVATE_SQL`. It enforces 0600 output permissions. Do not commit private files. Incompatible/replayed configuration cannot reset resolved holds or silently change the effective date; incompatibility leaves observations disabled for reconciliation.
4. Verify enabled policy and exact held instance against the private deployment plan before serving the new code. Deploy the Worker changes and bundled shared attribution helper, then publish only the tutor/shared frontend files. Do not deploy from an obsolete branch. Old frontend/new Worker safely masks/409 during the short mismatch window; new frontend/old Worker is not a supported ordering.
5. In the authenticated tutor settings, run the initial observation sweep to completion and inspect its exceptions before announcing coverage. This is the approved baseline metadata/source-capture operation; it never confirms old owners or changes existing lesson content. Individually resolve the specifically held lesson through the explicit review UI when the owner makes the choice. Do not preselect that choice in SQL.
6. Verify today's ordinary legacy plans/completion remain visible with unverified labels, the held instance has no adopted baseline, future meaningful renames block content, both decisions preserve source/history, recurring instances/time moves are safe, MCP/notification output is qualified, and 320/390/1280px UI remains usable.

Publication scope is additive D1 schema + private hold/policy activation + Worker + tutor/shared assets + initial observation sweep. It excludes ToDo, Wiki, Workflow, Google Calendar mutations, profile moves and automation changes. Current main PR127 is retained; unrelated UX files are unchanged relative to that main.

## Rollback and review

The migration is additive and SQL-compatible with old binaries, but a pre-feature Worker ignores holds/identity/baselines and can expose ID-only content again. Retain the safe Worker behavior and all source/archive/identity/baseline/hold tables and triggers; pause new observations via policy if needed and forward-fix. Never drop identity while triggers reference it, delete sources/archives, or restore a whole old database over later edits without reconciliation.

Independent review previously caught and corrected empty-placeholder overblocking, MCP collision bypass, post-commit generation leakage and misleading incomplete counts. Prospective-baseline review additionally checks first MCP writes, held-empty instances, large batch masks, fail-closed configuration, initial sweep coverage and unverified aggregate labels. All validation uses local synthetic fixtures. Repository instructions/skills were checked; none were present in this checkout or `/workspace/.agents`.

## Validation evidence

The prospective implementation passed the full Worker suite **147/147** and tutor unit tests **47/47**. Three browser suites passed: existing two-way next plans and conflict handling; explicit attribution decisions/history; and prospective baselines with retained legacy fields, NULL owner identity after observations/edits, immutable source inspection, known holds, initial-sweep action and future renames. Mobile/desktop checks covered 320/390/1280px. Local synthetic screenshots are under ignored `worker/test-artifacts/lesson-baseline/` and `lesson-attribution/`.

Real Worker runtime tests cover first MCP edit observation, legacy update→undo retaining NULL owner identity, initial sweep date filtering and post-baseline title changes. Unit tests cover JST midnight, immutable original source, known/empty holds, historical edits, incompatible/replayed private activation and cross-chunk collision retention. Independent review found no remaining structural blocker after the fixes. Worker `wrangler deploy --dry-run`, syntax checks and `git diff --check` passed. ToDo/Wiki/Workflow and dependency files remain identical to current main PR127. All writes in tests were local synthetic Miniflare data; no production operations were performed.


### Initialization request budget and recovery

The server accepts older callers sending `limit:25` but caps each invocation to at most two records. It counts every selected calendar and reduces the cap further to stay below a conservative 45-subrequest budget, including cold D1 schema checks, statement counts, settings/token reads and OAuth refresh. With more than 17 selected calendars it refuses before Calendar requests or observations; review the selected calendar configuration rather than repeatedly retrying.

The UI waits at least one second between pages. Processing is sequential; a transient Calendar error returns `retry_required:true`, `done:false` and a cursor covering only the completed prefix. The UI stops and asks for a later retry. Restarting from `cursor:""` after any lost response is safe: persisted baselines are excluded, original baseline titles and immutable legacy snapshots are never replaced. Historical/unavailable/collision records may be read again; they are not assigned ownership. A repeat attempt does not resolve known holds. The helper can continue via the existing settings button; no SQL backfill is needed.
