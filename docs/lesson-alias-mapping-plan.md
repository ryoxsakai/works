# Next phase: explicit lesson alias mapping (not implemented)

Current guard: `shared/student-profile-key.js` accepts the exact event title or the original deterministic curriculum selection key only. Restored token/description aliases outside those keys remain read-only (L13d). Names are storage keys, not proof of student identity; same-name profiles may be shared. Calendar/event attribution holds and record revisions remain independent requirements.

Proposed first safe scope:
1. Show the selected event's calendar, date, source title, current attribution state and the exact candidate profile key. Explain which profile/progress fields would be edited, without claiming legacy ownership has been verified.
2. Require the owner to explicitly choose/enter the target profile key and acknowledge same-key sharing. Do not auto-select a candidate by similarity, annotation removal beyond the existing deterministic rule, old memo, same-name history or schedule position.
3. Bind the mapping to the exact authenticated source `(calendar_id,event_id,canonical title,attribution revision)` initially. Recurring instances or other events receive no implicit mapping. A wider scope would need separate explicit design/confirmation.
4. Add an optional mapping id to existing guarded profile/planning requests. Resolve it server-side and reject changed titles/calendars, holds, disabled mappings, missing source records or stale revisions. Never relax the old full-title/curriculum validation for ordinary callers.
5. Make creation/disable append-only audited and CAS/idempotency protected, with exact frozen expected state. Preserve all profiles, progress and lesson content. A mapping authorizes a chosen key for a source; it does not merge/copy/delete/rename profiles, move lesson records, confirm ownership or resolve holds.
6. Support read-only inspection of unknown results with the same operation reference; no automatic create/replay. Explicit disable stops future mapped writes without erasing audit/history. Mapping changes must require unsaved input to be saved or explicitly discarded, with queued autosave intents frozen to their original mapping revision.

Before implementation, inventory the existing profile/planning validators and student-search restore behavior. Prefer a browser-only additive endpoint/table behind unchanged defaults. Any required schema/backup rollout must be made concrete and verified before deployment; no SQL or production mappings are part of this SS phase. Rollback leaves old clients strict/read-only for unsupported aliases and preserves mapping history.

Synthetic acceptance matrix: duplicate names and shared keys; multiple calendars/same event ids; recurring instances; moved times; title correction/replacement and held legacy records; no selected event; wrong target/profile; stale mapping/profile/assignment/attribution revisions; interleaved autosaves; concurrent create/disable; unknown committed response/no replay; navigation/Back/Escape/reload; auth expiry; mobile/keyboard. Verify that no test implicitly adopts old content and that ordinary APIs still reject arbitrary names.

No real student alias mapping is created or proposed as an ownership determination here.
