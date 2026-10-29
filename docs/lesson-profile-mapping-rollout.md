# Lesson profile mapping rollout — not applied

SQL: `worker/migrations/20261029_lesson_profile_mapping.sql`

SHA256: `369f4e8e78f74d1eed2657d81b2da711773b4274a61523a51aa327d91d20bcfc`

Adds exactly one table `lesson_profile_mapping`, index `lesson_profile_mapping_source`, and triggers `lesson_profile_mapping_no_update` / `lesson_profile_mapping_no_delete`. No existing rows/tables are rewritten. No initial mapping or ownership assertion is inserted. The optional migration is not runtime DDL or part of automatic baseline schema initialization.

## Required release steps

1. Verify final exact-head CI and source/migration hashes. Validate the selected-calendar request budget before activation: the cold alias-progress synthetic test measures40 D1 statements +5 external requests for four selected calendars; arbitrary calendar counts are not certified. Alias progress is capped at4 changed chapters; ordinary operations remain8.
2. Have the existing authorized Mac release helper take a fresh private tutor-db backup, verify bytes/hash and a local restore/integrity check. This cloud environment has no configured production D1 connection; do not introduce alternate credentials or export destinations.
3. Rehearse this exact SQL on that restored copy; compare existing lesson/profile/planning/material/progress counts and content aggregates before/after without displaying student content.
4. Only after those prerequisites, use the existing release connection to apply the additive SQL. Expected command shape (NOT executed here): `wrangler d1 execute tutor-db --remote --file worker/migrations/20261029_lesson_profile_mapping.sql`.
5. Verify four named sqlite_master objects, zero mapping rows, integrity and unchanged existing-record aggregates. Read-only authenticated GET `/api/lesson-profile-mapping?list=1` should return `available:true`, an empty mappings list and no next cursor. Do not create a real mapping for QA.

Object verification shape:

```sql
SELECT type,name FROM sqlite_master WHERE name IN (
 'lesson_profile_mapping','lesson_profile_mapping_source',
 'lesson_profile_mapping_no_update','lesson_profile_mapping_no_delete');
SELECT count(*) FROM lesson_profile_mapping;
PRAGMA integrity_check;
```

## Ordering and rollback

Code can deploy before schema: missing or partial exact schema returns `available:false` on reads and503 on mapping mutations. Unsupported aliases remain read-only. Existing full-title/curriculum operations continue working; tested ordinary APIs do not depend on this table. No environment activation setting is required. Deploying code alone does not activate mapping support.

Rollback to old code leaves this optional table and immutable audit intact. Retain all association/history rows; do not DROP or delete them. Old clients continue their original strict key validation. Schema presence, authenticated runtime behavior and actual deployment remain separate verification gates.

Status: local isolated migration and safety tests passed; production backup, DDL and authenticated observation are pending. No production data or association was changed.
