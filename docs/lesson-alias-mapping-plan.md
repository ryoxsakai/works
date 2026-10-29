# Explicit lesson profile mapping — implementation checkpoint

Implemented locally on `feat/explicit-lesson-profile-mapping`, based on main `1a49b56ef2ca1067dfecb312bb9aa970058feb34`. Publication and browser certification remain pending.

The browser-only `/api/lesson-profile-mapping` endpoint accepts GET inspection and same-origin JSON PUT bind/disable operations. Names are storage keys, never proof of student identity. The user must see the exact calendar/event/title/date and target profile key, type that key without suggested matching, preview its snapshot and explicitly acknowledge source, target and shared-key implications. Existing holds remain blocking. No profile, progress or lesson content is copied, merged, renamed or deleted.

Bindings are per `(calendar_id,event_id)`, exact title and attribution generation. Creation additionally checks the fresh lesson revision and complete target profile snapshot. Ordinary lesson-content saves do not invalidate the binding; title changes, replacement generations, holds and disable do. Recurring instances and other calendars receive no implicit association. Existing full-title and deterministic curriculum APIs keep their original restrictions.

Append-only bind/disable operations use latest-id CAS, immutable operation IDs and request hashes. Profile, progress, goals, schools and material writes check the active mapping in the same D1 transaction. Frozen queued autosaves keep their original mapping revision. A concurrent revocation stops writes. Unknown outcomes retain the operation reference for read-only inspection; inspection never retries or activates an editor automatically. Explicit disable preserves all history and content, including when the old source is no longer eligible.

The settings entry opens metadata-only association history with pagination and explicit disable. An unsupported restored alias stays read-only until the exact source is current and an explicit binding exists. No legacy ownership label is restored. Machine tokens cannot access mapping administration; no new scope, credential or grant is introduced.

## Verification

Local results:118 app unit tests;9 actual isolated-D1 mapping tests;1 exact additive migration test;22 existing linked-profile/planning regression tests pass. Tests cover wrong/changed sources, recurring/cross-calendar isolation, holds/generations, profile CAS, concurrent binding, revocation-before-commit, immutable history, lost acknowledgements, replay identity, partial schema, ordinary API compatibility and browser-session/Origin/method gates.

The existing native lesson browser suite is extended for explicit confirmation, in-flight navigation, mapped edits, disable, history and unknown-outcome inspection. A twentieth cross-module suite is prepared. These browser tests have **not run in this checkpoint**: the local Chromium executable is absent. Exact-head CI must pass before publication. No real student mapping or production test save was performed.

See [rollout prerequisites](lesson-profile-mapping-rollout.md) and [cross-cutting verification](full-parity-cross-cutting.md). This checkpoint does not declare full migration or live activation complete.

Independent review found a missing in-transaction revocation check in chapter-progress writes. The same mapping guard used by profiles/planning is now included before progress mutations, and a synthetic revoke-before-batch regression verifies zero progress changes. The schema-absent test exercises successful ordinary full-title/curriculum profile, goal and progress writes, not just availability metadata.

Budget review: alias progress writes are capped at4 changed chapters per request (ordinary full-title/curriculum remains8), with matching UI guidance. A counted cold actual Worker HTTP test, including schema initialization and four selected calendars, measures40 D1 statements +5 external requests. This is a scoped measurement, not a guarantee for arbitrary calendar counts. Validate the selected-calendar request budget before production activation.

Calendar-count follow-up: the guarded settings API already has a1000-value limit, while legacy readers remain unbounded. Projected read-only Google batch collision lookups preserve all source checks without imposing a new setting cap. Synthetic cold/warm actual Worker validation covers1,4,8,20,49,50,100,1000,1001 calendars, absent/malformed mappings and both unlink/save orderings. See `lesson-profile-load-validation.md` for measured SQL, binding and network counts and remaining live checks.
