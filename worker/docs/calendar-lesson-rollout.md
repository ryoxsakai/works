# Calendar lesson record migration — staged, NOT activated

User scope: individual lesson events starting 2026-10-20 00:00 Asia/Tokyo onward.
Source: D1 `curriculum_entries`; student memo stays in D1. R2 is unrelated.
Old `/tutor/`, home widget and all URLs remain. Hidden fields stay hidden.

## Current checkpoint

Implemented foundation only: existing-token Google adapter (including paginated ACL), lossless four-field description codec, conservative
offline dry run, conditional single-instance export, persistent reservation and
unknown-outcome reconciliation, and explicit empty-next-instance template planner.
**No runtime routes call these writers. No production feature flag is enabled.**
The journal guard is opt-in; default production behavior is unchanged.

The rendered managed content is four newline-separated headings, with values
immediately after the full-width colon. Empty values remain empty. Hidden HTML
comment boundaries and binding metadata identify the owned region; unmanaged
description bytes remain unchanged. Live Google HTML normalization roundtrip is
not yet verified. A rewritten/malformed region is held rather than guessed.

## Exact access prerequisites (pending)

- This cloud environment has no configured production Cloudflare/Google identity,
  secrets or authenticated browser. Do not discover tokens in files or introduce
  alternative credentials.
- `shared/auth.js` requests `calendar.readonly` and `calendar.events`, which allow
  event reading/writing but **not** `acl.list`. Existing refresh token's actual
  granted scopes are not inspected. Google requires `calendar`, `calendar.acls`
  or `calendar.acls.readonly` for ACL inspection. Do not add a grant automatically.
- Existing authorized connection must obtain fresh private DB backup + event/ACL
  snapshots, with permission for the private destination. If an already granted
  ACL-capable connection exists, reuse it; otherwise report the minimum additional
  scope needed. No activation until sharing can be established reliably.

## Required remaining implementation before activation

1. Connect the tested Google adapter to existing runtime dependencies; paginate complete ACLs, verify owner and event guests,
   use existing OAuth only, `PATCH` description on the exact instance ID with
   `If-Match` and `sendUpdates=none`, then GET it. No series-master mutations.
2. Wire Calendar source reads + writes through existing attribution/CAS handlers:
   current lesson, next lesson, curriculum read/write, schedule/MCP notifications,
   audited update/undo/batch paths. A Calendar/D1 operation is not one transaction:
   durable reservation and explicit reconciliation are mandatory. D1 mirror and
   journal finalization must be atomic; source snapshots must remain archived.
3. Client ETag propagation after its own Calendar save: update both source/target
   references and serialized memo guards, including queued edits. Do not silently
   ignore ETags to make repeated saves work.
4. Explicit browser-only idempotent POST for empty next-instance initialization;
   GET, schedule reads and notifications must never trigger it. Keep persistent
   failure/unknown status and input intact. A template is not a lesson plan value.
5. Tests against actual protected Worker routes, synthetic Google/D1, old Tutor and
   home UI: four fields/multiline, hidden values, memo untouched, repeated save,
   next-target changes, instance/series, source rename/generation, collisions,
   concurrent unlink/attribution/profile edits, 412/403/429/5xx/lost response,
   reload/partial resume, budgets at supported calendar counts, notifications.

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
5. Deploy compatible backend first, verify exact version, then frontend. Enable
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
