# Lesson profile mapping rollout — not applied

The batching code at `8dff5752b7952a42232976935b31a22212e248a0` was independently reviewed. A documentation-only rollout clarification follows that head. Use the final PR head and its terminal exact-head CI for release, not this earlier source-review reference. No operation in this document has been executed against production.

SQL: `worker/migrations/20261029_lesson_profile_mapping.sql`

SHA256: `369f4e8e78f74d1eed2657d81b2da711773b4274a61523a51aa327d91d20bcfc`

Adds one table `lesson_profile_mapping`, explicitly named index `lesson_profile_mapping_source`, and triggers `lesson_profile_mapping_no_update` / `lesson_profile_mapping_no_delete`. No existing rows/tables are rewritten. No initial mapping or ownership assertion is inserted. The optional migration is not runtime DDL or part of automatic baseline schema initialization.

## Release gates and chosen order

**Chosen order: fresh backup → restore/rehearsal → additive production SQL verification → approved merge → reconcile actual Worker and Pages deployments → authenticated read-only observation.** Keep PR157 draft and do not merge until the parent confirms the backup and SQL prerequisites. No Mac, credential or production operation is part of the current cloud task.

1. Freeze the final full PR head/tree and terminal CI results, SQL hash, current deployed Worker version/traffic and Pages source/artifact IDs. Calendar-count validation covers the guarded maximum1000 and legacy1001: cold42 SQL statements,17 DB binding calls and12 external calls; warm31/16/12. Alias progress is capped at4 changed chapters; ordinary8 remains. See `lesson-profile-load-validation.md` for exact scope, not production CPU/latency certification.
2. Through the existing authorized release connection, have the existing Mac helper take a **fresh** tutor-db SQL backup in the owner's private folder (folder0700/file0600), verify nonzero bytes and full SHA256, and retain its timestamp and exact DB identity. Do not publish backup contents, add credentials/grants or use another export destination. This cloud environment has no production D1 connection and must not substitute one.
3. Restore that actual backup locally; verify `PRAGMA integrity_check` is `ok` before any rehearsal. Record existing lesson/profile/planning/material/progress row counts and non-content aggregate/hash comparisons privately. Rehearse this exact additive SQL on that restored copy, verify the four object definitions and zero association rows, rerun it to establish idempotence, and require integrity plus all preexisting content/completion aggregates to remain unchanged. A fixture-only migration test is not evidence that the fresh production backup restored correctly.
4. After those prerequisites are confirmed, the existing release helper may apply the exact verified file. Expected command shape, **NOT executed here**: `wrangler d1 execute tutor-db --remote --file worker/migrations/20261029_lesson_profile_mapping.sql`. Record operation result/time. For an uncertain result, reconcile actual schema first; do not blindly repeat SQL or switch credentials/routes. Stop on a denial or unexplained mismatch.
5. Verify exact table/index/two trigger definitions, zero association rows, D1 `PRAGMA quick_check` returning `ok` and unchanged preexisting aggregates using metadata-only/private comparisons. **Do not expect the new HTTP endpoint yet:** the old production Worker can still be deployed. No known hold is resolved, legacy ownership verified or real mapping inserted.
6. Parent confirms prerequisites; then ready/merge the already-approved PR only after its final exact-head checks pass. Match the merge tree to the tested tree. Observe the existing automatic Worker and Pages pipelines; do not add a manual redeploy because a result is unclear. Reconcile each existing build/deployment reference to terminal status first. Worker readiness is the API gate; verify the deployed Worker source/build/version and intended traffic actually match the merged code. Verify Pages deployed that merge and retrieve `/app/index.html` plus each referenced JS/CSS through the existing release connection, comparing bytes/SHA256 with the exact merged tree and retaining artifact/deployment evidence.
7. Worker and Pages automatic delivery can overlap. A temporarily newer frontend against the old API must remain unavailable/read-only: unsupported mapping GET cannot enable confirmation; old strict-key APIs reject alias writes. The new Worker with missing/partial schema returns `available:false` on mapping reads and503 on mutations. Neither ordering auto-migrates or creates associations. Do not declare the release ready until **both** deployments and assets reconcile; observe Worker readiness before final frontend smoke tests.
8. Perform the authenticated read-only observations below after both deployments. Record actual results separately from CI. Stop on unexpected source, content, association or deployment identity. No real mapping/save is required for QA.

## Read-only observations and evidence

Before SQL, retain baseline private DB aggregates and current ordinary-source behavior through the existing authorized connection if available. The selected source must already have a confirmed identity or observed baseline and no hold; do not use an unobserved legacy record, because ordinary lesson GET can itself record the existing prospective baseline. Do not choose or confirm student ownership for this test. Cloud synthetic tests already prove table-absent ordinary profile/goal/progress operations and disabled mapping controls; they are not a live production pass.

After SQL, metadata verification shapes (definitions must be compared to the verified file, not just counted):

```sql
SELECT type,name,sql FROM sqlite_master WHERE name IN (
 'lesson_profile_mapping','lesson_profile_mapping_source',
 'lesson_profile_mapping_no_update','lesson_profile_mapping_no_delete');
SELECT count(*) FROM lesson_profile_mapping;
PRAGMA quick_check;
```

The full `integrity_check` above belongs to the local SQLite restore/rehearsal. For remote D1, use its [documented `quick_check`](https://developers.cloudflare.com/d1/sql-api/sql-statements/#pragma-quick_check), not an assumed remote `integrity_check` capability. SQLite-created automatic indexes for primary/unique constraints are additional to the four named migration objects.

After the exact Worker/Pages release:

- Authenticated GET `/api/lesson-profile-mapping?list=1`: `available:true`, `mappings:[]`, `next:null` for this first activation. Any preexisting association is a reconciliation blocker; do not clear it.
- GET `/api/lesson-plan?calendar_id=...&event_id=...` for the already-attributed source: exact current target, expected attribution status and revision, expected existing plan; do not copy student content into release logs. GET `/api/student-prefs/guarded?calendar_id=...&event_id=...` for that same source verifies ordinary strict-key reads. Compare the pre/post private aggregates to exclude an unintended baseline/content write.
- With at least10 **currently selected** calendars, the lesson-plan GET exercises actual batch collision lookup. Confirm complete success or a correct explicit collision/error outcome; no ambiguous result may be presented as confirmed current content. If the current count is smaller, mark the real-Google batch wire path **not exercised**. Do not change calendar settings, acquire credentials or add grants to force that path. An existing authorized read-only upstream check may be recorded separately if already available; otherwise this stays an access-dependent observation gap.
- Read-only UI smoke: directly open `/app/#!/teaching/mappings/` (list-only) to verify empty mapping history, exact deployed assets and zero mutation requests. Do not use broad teaching/student/history/next discovery as a read-only QA check: background GETs may establish prospective baselines for other unobserved legacy events. Ordinary teaching UI smoke is allowed only on an isolated route after every automatically loaded source/next/history target has independently been established as already observed/confirmed; otherwise defer it. A confirmed primary source alone is insufficient. Verify old top/old route retention from deployed assets/configuration without opening pages that auto-load unidentified lesson records. Record actual iPhone, keyboard/safe-area and physical printing only if inspected within those boundaries; otherwise leave them unverified.

The new mapping endpoint is absent under old code, so `available:true` is a **post-deployment** gate, not an immediate post-SQL expectation. No separate activation environment setting is required. Schema and code availability together control support; code-only deployment is fail-safe but is not the chosen release order here.

## Rollback and recovery

- Retain the prior matching Pages artifact/source and Worker version/traffic before release. If rollback is needed, restore the prior Pages artifact first to withdraw the new mapping UI, then restore the prior Worker version; reconcile actual artifacts/version/traffic and perform the same ordinary-source read-only smoke. Do not mistake a queued rollout or GitHub test-merge SHA for a deployed release.
- Both mixed-version directions remain strict: old clients do not send mapping context; old guarded APIs reject unsupported alias context. Temporary unavailability is a stopped operation, never permission to retry a possibly committed save.
- **Retain the optional table and all immutable audit/history, profiles, progress and lesson rows. Do not DROP, delete, merge or auto-disable mappings.** Old code ignores the optional table and keeps its original key checks.
- The backup is recovery evidence, not an automatic database rollback. Restoring it later could erase legitimate intervening edits. Any disaster restore requires its own concrete reconciliation/recovery decision; code rollback does not imply DB restoration or content ownership reassignment.
- If any real operation has an unknown result, retain its exact reference, inspect current state without replay, and stop pending reconciliation. No automated bind, hold resolution or test save is part of release verification.

Status: synthetic migration, absent-schema safety, load and browser checks passed at their recorded heads. Fresh production backup/restore rehearsal, SQL, merge/deployment and authenticated observation remain **pending**, not completed or denied. Actual production CPU/latency/Google batch responses and device/output verification are not certified by CI.
