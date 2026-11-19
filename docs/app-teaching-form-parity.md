# Lesson input parity — local review checkpoint

Base: main `013807664bce535a9a5b1f29baef97368933979e` (PR #138). Compare code, not a new authenticated production/Mac observation. This branch changes frontend input presentation and validation only; no Worker/API/schema/auth changes.

## Field-by-field comparison

| Item | Original Tutor | /app/ in this change |
| --- | --- | --- |
| Current lesson plan | `tutor/app.js` 584–587 and `lessonPlanEditor`: textarea, 5,000 characters, persisted plan | Immediately available textarea, same label and 5,000-character changed-value bound. Existing value is not copied from a prior/next lesson. Oversized untouched legacy plans are omitted from a patch. |
| Confirmation test | `record-test`, textarea populated from `confirmation_test` | Same field/default; immediate textarea. |
| Homework | `record-homework`, textarea populated from `homework` | Same field/default; immediate textarea. |
| Lesson memo | `record-memo`, textarea populated from `lesson_memo` | Same per-event field/default; distinct from shared student memo. |
| Completion | Curriculum table checkbox; daily record preserves its existing completion | Existing `completed` boolean checkbox, unchanged default and explicit saved patch. |
| Student memo | Daily record `record-student-memo` and student tab `student-memo`; shared by exact trimmed name | Nearby linked editor, same existing name key/value, content-sized textarea with shared-across-dates placeholder. Explicit acknowledgement and guarded save retained. Never moved by a title correction. |
| Print name | `tutor/index.html` 362–363: optional print name, fallback to selected name | Optional print name, fallback to current event title, matching label/placeholder. Printed heading uses loaded name; ordinary heading/identity remain the calendar title. Print button waits for profile read. |
| Student memo on paper | Student tab marks memo “印刷されません”; optional memo section is excluded | Shared profile panel is excluded from print. Current record still prints using a separate saved-value copy rather than empty/hidden forms. |
| Next lesson plan | `record-next-plan`: textarea, 5,000 characters, explicit target and separate persistence | Nearby linked editor retains target date/name, 5,000-character bound, unique-next lookup and source/target/revision/expected-plan guards. Content-sized input. |
| Assigned curriculum/progress | `renderStudentMaterials`: assigned materials and chapter completion, empty state | Existing assigned curriculum/chapters and guarded completion editing retained. No assignment mutation added. |
| Layout | Daily table / curriculum table, textareas resize to content and width | Immediate record input; two aligned columns on PC, single column at ≤650px. Related editors sit beside the record on wide PC, below it on smaller screens. Current blue/white palette retained. |
| Navigation | Daily date navigation and separate student/term table | Existing JST day navigation, composite lesson deep links, Back/Forward, old Tutor link and routes retained. No initial autofocus or write on opening the form. |

## Deliberate save differences / remaining parity gaps

Tutor writes test/homework/lesson memo on `change` (`tutor/app.js` 755–783); plan/student memo have their own controllers, and progress writes on each checkbox change. /app/ retains **explicit Save**, single-flight protection, source/attribution/CAS guards and blocked resend after unknown outcomes. Opening inputs, blurring, resizing and clicking the input shortcut do not save. A dirty record disables switching to linked editors, with visible instructions to save/cancel first. A pristine record can switch to one linked editor; its inputs are temporarily hidden and the saved record preview remains available. There is no misleading all-panels save.

Student profile edits still have their existing 20,000-character memo/200-character print-name limits. Progress still saves at most eight changed chapters per batch. These guarded behaviors are not replaced with the legacy unconditional endpoints.

This is not full Tutor parity: previous-lesson summary, term-based lesson counts/student history, material assignment/removal/reordering, full student information/other student sections, calendar settings and attribution-resolution operations continue in the original Tutor. No data is migrated or automatically associated. The hidden legacy attribution label stays hidden. The first priority here is the actual current-lesson input form.

## Validation and publication

Synthetic tests cover immediate populated inputs; no blur/autogrow writes; all current fields and completion/CAS patches; 5,000-character plan bounds with untouched oversized legacy data; dirty linked-editor switching; explicit cancel/discard; 409/unknown saves and read-back; growing textareas after input/width changes; 320/390/768/1440px layouts; keyboard navigation, focus return and print name/private-memo exclusion. Existing eight browser suites and Tutor/linked API/next-plan tests remain regression checks. Screenshots are generated locally under `prototype/test-artifacts/teaching/parity-*-input.png` (not published attachments).

No production saves were used. Real iPhone / authenticated production visual comparison and real multiline production examples remain unverified. The user is travelling, so Mac access is not a prerequisite for this local checkpoint.

New publication authorization is required before pushing this branch, opening a draft PR, merging or deploying. No such action is attempted by this checkpoint. No new Worker deployment or migration will be needed for these frontend-only changes. A subsequent release should run exact-head CI and confirm Pages assets before read-only/edit-cancel production observation.
