# Calendar lesson record migration — staged, NOT activated

User scope: individual lesson events starting 2026-10-20 00:00 Asia/Tokyo onward.
Source: D1 `curriculum_entries`; student memo stays in D1. R2 is unrelated.
Old `/tutor/`, home widget and all URLs remain. Hidden fields stay hidden.

## Current implementation (activation remains OFF)

Existing-token Google adapter, lossless four-field codec, offline and protected
browser dry runs, instance-only export, persistent reservation/unknown-outcome
reconciliation, runtime source readers/writers, original Tutor/home shared editors,
next-instance explicit template POST, own-save ETag propagation, and explicit
inherit/separate flows are connected. MCP `get_schedule` and schedule-based
notifications read the same Calendar fields. Student memo remains DB-only.

Default production behavior remains D1 until the release operator sets activation.
No schema/record/Calendar mutation was performed by development. Rendered managed
content has four newline-separated headings; empty values stay empty. Hidden HTML
comments delimit the region and its binding; unmanaged bytes are preserved. Actual
Google UI normalization is not verified; malformed regions fail closed.

Unverified legacy records remain readable/editable under their previous DB guards;
they are never automatically confirmed or exported. An empty managed template is
not a lesson plan value. A source rename requires explicit inherited/separate
confirmation, preserving both DB archive and complete Calendar preimage.

## Access and activation prerequisites (pending)

This environment has no configured production Cloudflare/Google identity, secrets
or authenticated browser. Use an existing authorized connection, never discover or
add credentials. Current requested scopes do not include ACL read. User explicitly
attested that the three named calendars are private. Provision their **exact IDs**
privately as `CALENDAR_LESSON_ATTESTED_CALENDARS` JSON array; do not hardcode names,
IDs or people in source. Evidence basis is `owner_attested`, never `acl_verified`.
The live CalendarList owner role and event organizer/guest checks remain mandatory.
Any extra guest/omitted attendee list/non-owner/locked event is held. Unlisted
calendars require actual complete ACL evidence via an already granted connection;
an insufficient grant is held, not expanded.

Required operator settings after fresh backup+restore and additive schema:

- `CALENDAR_LESSON_MIGRATION_JOURNAL=true`: pending reservation guards enabled.
- `CALENDAR_LESSON_ATTESTED_CALENDARS`: private exact approved calendar IDs only.
- `CALENDAR_LESSON_BACKUP_SHA256`: full lowercase SHA256 of verified private backup.
- `CALENDAR_LESSON_BACKUP_CAPTURED_AT`: its actual ISO capture time, within24h.
- Finally `CALENDAR_LESSON_RECORDS=true`: source reads/writes and browser template
  initialization enabled, only from the JST cutoff. Enable after reviewed transfer.

No setting is included in wrangler.toml by this change. Missing/expired backup
blocks apply. Missing journal activation blocks Calendar writes; never silently
fall back to DB for a record already stored in Calendar.

## Existing authenticated browser operations

All endpoints require the existing owner browser session; MCP/API-key tokens cannot
invoke transfer or initialization. Use existing auth; do not copy tokens to chat.

1. `GET /api/calendar-lesson-migration/records?cursor=...` returns10 source event IDs
   at a time, including orphans. Iterate its cursor to `done`; no record init occurs.
2. `POST /api/calendar-lesson-migration/preview` with `{event_id}` returns raw source,
   original full event, privacy evidence and conservative plan. One record per call
   bounds Google/D1 requests. Store response privately, review every mapping and
   hold reason. 404/ambiguous resolution is a hold, never inferred calendar identity.
3. `POST /api/calendar-lesson-migration/apply` with `{plan: preview.plan}` revalidates
   the same record/event/privacy. It requires fresh verified-backup settings and
   journal. No bulk unreviewed transfer. Each response follows GET verification.
4. `POST /api/calendar-lesson-record/reconcile` with `{target:{calendar_id,id}}`
   performs no Calendar mutation. Exact postimage+unchanged identity can finalize
   a previously dispatched unknown write; otherwise keep locked. The old image
   alone never releases an unknown write. Tutor/home provide an explicit button
   on a reloaded pending card. A still-reserved operation requires operator review.
5. `POST /api/next-lesson-plan/initialize` is called only by browser next-lesson
   reads with explicit source/target proof, deduplicated per account/target. Standard
   GET and MCP reads have no initializer side effects. Nonempty description stays.

## Deliberate compatibility boundary

MCP batch/history text mutations for post-cutoff Calendar targets are rejected
before D1-only writes: cross-event Calendar mutations cannot preserve the former
single-D1-transaction atomic semantics. They must not silently bypass Calendar or
pretend rollback. Use the original browser editors for these targets. Read tools,
notifications, pre-cutoff operations and unmigrated UI/DB records are preserved.
This limitation must be stated in release reporting, not called full MCP write
parity. Future batch/undo receipts are a separate coherent enhancement.

## Backup, dry run and execution order

1. Freeze activation, reconcile any in-flight operation. Fresh private D1 export,
   record content/completion aggregates, full relevant Calendar event snapshots
   (description, ETag, instance/series ID, organizer/guests, extended properties),
   complete ACL evidence, hashes and capture time. Restore D1 locally and run
   integrity check. Do not put snapshots or student names into GitHub artifacts.
2. Offline dry run using the reviewed module; input0600, output directory0700:
   `node worker/calendar-lesson-dry-run.mjs PRIVATE_SNAPSHOT.json PRIVATE_REPORT.json`
   Input keys: `ownerEmail`, `records`, `events`, `privacy`, optional `excluded`.
   Output is exclusive-create0600, with exact ID mappings, ready/held/empty/
   historical/already_present counts. No network or writes occur.
3. Review holds: unverified legacy attribution is not export consent. Unknown
   ownership, collisions, guests, non-owner/shared detail access, unknown sharing,
   existing field-text conflicts, malformed managed region and series master are
   held. No automatic profile matching or ownership resolution.
4. After full integration tests and CI, apply additive
   `worker/calendar-lesson-migration.sql` through the existing authorized helper.
   Verify table/index definitions and source aggregates unchanged. Back up again
   before activation if intervening changes occurred.
5. Deploy compatible backend first with source activation OFF, verify exact version, then frontend. Enable
   journal guard only when schema and ACL adapter are ready. During rollout all
   writers must honor reservations. Do not mix old backend versions with active
   reservations. A missing journal must fail closed, not silently save to D1.
6. Reserve one inspected record; retain complete before image, revision, generation
   and after description. Re-fetch event/record/sharing just before reserve/patch.
   Patch once with original ETag. Verify exact instance identity and complete
   description by GET; finalize journal with unchanged source revision/generation.
   Preserve all D1 source data. Continue bounded batches only after budget checks.
7. Unknown dispatch remains locked. Reconcile the same operation by GET; exact
   after image can finalize. Seeing the old image does not prove a timed-out
   request has finished: do not unlock, retry or start a replacement operation.
8. Report actual counts per status and per-item verification. Never label the
   offline planner or CI as production transfer success.

## Rollback

Stop new dispatches; reconcile all reserved/dispatching/unknown entries first.
Keep journal/source snapshots and schema. Do not deploy an old writer that ignores
pending locks. Restore descriptions only from the captured preimage with a fresh
matching ETag and exact event identity, after checking no subsequent user edit;
otherwise hold for review. Never restore an entire calendar or series by default.
Before returning to D1 as display source, preserve/reconcile any post-migration
Calendar edits. Merely reverting the frontend would display stale DB values.

## Evidence

Official: https://developers.google.com/workspace/calendar/api/v3/reference/acl/list
and https://developers.google.com/workspace/calendar/api/guides/version-resources .
The latter documents conditional writes and 412; PATCH field preservation is
documented in the Events reference. No new OAuth scopes have been requested.

## Synthetic request-budget evidence

Three selected calendars, exact linked-save path with cold attribution schema:
Google19 + D1 RPC13 =32 transport calls (35 SQL statements within those RPCs).
Warm path Google19 + D1 RPC12 =31 (24 SQL statements). This is synthetic counting,
not production telemetry. Larger calendar counts and long Google pagination need
separate budget validation before activation; do not infer an unbounded guarantee.
A managed event moved across the cutoff retains its Calendar source. An untouched
pre-cutoff event stays DB-only. Clearing an already managed description reads as
empty, never resurrecting stale DB shadow fields; original snapshots remain.
