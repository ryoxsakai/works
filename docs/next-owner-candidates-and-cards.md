# Next lessons and unassigned lesson plans

In active owner-history mode, schedule discovery distinguishes a missing lesson from a scheduled occurrence whose owner has not been explicitly confirmed. Previously an unassigned next week appeared as no lesson for 366 days.

Confirmed same-owner occurrences retain fixed-ID behavior across display-name changes. Confirmed different owners are excluded even with identical names. An unassigned same-title occurrence is only a review candidate, not an ownership inference. Its date and explicit binding link are shown. Tied earliest candidates remain ambiguous. Discovery never creates owners, records, links or Calendar descriptions. Source-owner races and dirty drafts are held rather than overwritten.

Unassigned cards and unassigned next candidates expose a lesson-plan textarea. Explicit edits save to `lesson_pending_plans`, separately from owner history. Each draft is scoped to the exact Calendar occurrence, observed target (including ETag/name/time) and event creation identity. A rename, move, recreation or later owner binding cannot silently adopt the old draft. No name matching transfers content, and no Calendar description is written. Student memos and the other three owner-record fields are not exposed on unassigned cards.

A device recovery copy retains unsaved input and the request UUID before dispatch. Unknown outcomes prohibit resending and binding navigation until audit/readback verification. Changed-context copies remain downloadable and link to operation lookup. Device copies are not presented as D1 persistence. Storage failure is visible. History offers saved pending drafts, including deleted-event contexts, and JSON download. After explicit event/owner binding, the user can acknowledge a comparison and copy one into the record's unsaved plan form; the normal conditional save remains a separate explicit action. Existing unsaved record input blocks adoption.

The next read checks source ownership before a full schedule-range fetch, reads binding IDs once, and inspects only the earliest relevant candidate. The broad `search_schedules` API is unchanged. Legacy `students` and fixed `lesson_owners` remain separate models.

All real card rows carry a shared marker, including owner-review/excluded-review rows. The mobile carousel includes them in width, navigation and counting. Unassigned cards show only their own pending plan, never another owner's record. Legacy row selectors remain supported.

## Deployment prerequisite

This change is not deployed. Apply the additive `worker/migrations/lesson-pending-plans.sql` before serving the new Worker/UI. The existing bootstrap schema also contains the new table. Preserve all existing tables and backups; no existing rows are migrated or reassigned. Missing schema produces an explicit unavailable-save response while preserving input. The migration has only been previewed/restored against a local backup copy. A new PR and production schema/code changes require their own authorization.

Regression coverage includes owner/name swaps, duplicate names, cancelled/recreated occurrences, ambiguity, zero implicit writes, bounded D1 reads, source-owner races, pending-plan CAS and idempotency, unknown-outcome reconciliation, explicit draft adoption and missing-schema errors. Synthetic mobile fixtures cover six cards at 320/393/1280px, Nov 10 next-candidate input, reload recovery and changed-context recovery. No real student records or screenshots are included in public code/tests.
