# Teaching linked editors in /app/

This increment retains the old Tutor, original home and all URLs. It adds editing of print name/profile memo, completion of already assigned curriculum chapters, and the next lesson's plan. It does not assign materials, rename students, move profiles, resolve ownership, edit schedules or change approval/execution permissions. Lesson/profile/next-plan reading retains line breaks without transforming stored text.

## Identity and concurrency

Profile/progress continue to use the existing exact trimmed calendar title as their name key. Names are not unique person IDs. Each edit explicitly acknowledges that the change affects information shared by that same name; correcting a lesson's attribution never moves this information. Held/renamed/ambiguous-calendar sources cannot authorize edits. Canonical calendar/event references and source record revision are frozen in each draft.

New browser-only GET/PUT endpoints `/api/student-prefs/guarded` and `/api/chapter-progress/guarded` preserve the old endpoints. PUT requires same-origin JSON, existing browser session and source lookup/attribution checks. The existing `lesson_record_guard` CHECK table and D1 batch provide atomic revision, snapshot and assignment guards. Profiles compare full existence/value/timestamp snapshots, including omitted fields. Progress compares assignment link, material/chapter names, existence/completion/timestamp; a changed chapter or concurrent edit rolls back the whole submitted batch. Progress is limited to eight changed chapters per save to bound requests/statements; larger selections remain editable until reduced. No database migration is required.

Next plans use existing `/api/next-lesson-plan` and `/api/lesson-plan` APIs with exact source and target references, expected destination plan and record revision. Existing server protections still choose the unique next eligible lesson in the same calendar/title, recheck the events, reject collisions and enforce attribution. This is not a copy into the current record.

One editor is active at a time. Busy saves block navigation, inputs and duplicate dispatch. Dirty Back/Forward/route changes require discard confirmation. Conflicts and unknown results preserve input, disable resending and expose a read-only latest-state check. Opening a fresh editor requires explicit cancellation/discard. Session expiry unmounts and clears private state. Success/cancel returns keyboard focus to the originating control. Local browser tests use synthetic data only.

## Deployment / rollback

Deploy the additive Worker routes first, then Pages; old UI and old clients remain compatible. If Pages arrives first, missing guarded endpoints fail closed with a retry/old-screen message; no fallback to unconditional writes. Next-plan endpoint already exists. No SQL, production backfill, ownership decision or credential/scope change is needed. Rolling Pages back leaves the additive API unused. Rolling the Worker back hides the new guarded editing sections; old Tutor works as before. Existing raw/legacy writer concurrency remains weaker, but full snapshot checks detect their changes when this new editor saves.

Cloud CI/build evidence does not establish authenticated iPhone or production editing QA. Initial observation should be read-only: open an existing lesson, check profile/material/next-plan previews and edit/cancel, navigate away with an unsaved synthetic local draft and decline discard, then cancel. Do not save test values into production.
