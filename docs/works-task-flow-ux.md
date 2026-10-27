# Works task-flow UX follow-up (2026-10-27)

This UI-only follow-up builds on PR126. It changes no SQL, APIs, connector permissions, real task records, schedules or execution policy. Automatic role-worker dispatch remains unconnected while the host connector catalog is stale.

## Observed friction and selected changes

| Synthetic teacher task | Before | After |
| --- | --- | --- |
| Capture tomorrow's parent-meeting preparation | Add to inbox, find card, open details, choose planned day, save | Choose Tomorrow beside capture, type title, Enter. Inbox remains the default; deadline remains unset. |
| Find an older lesson note among ToDos | Scan date groups or choose role/category | Search title and notes, with result count and explicit reset. Deadline warnings still cover all tasks. |
| Bring an inbox/future task into today's plan | Open details, edit planned day, save | One `今日に予定` action. It changes only plannedDay, preserving the real deadline. |
| Clone a task for another teaching day | Four repeated two-line buttons wrap into multiple rows | Four direct compact choices remain visible; a shared label explicitly says independent clone. The date is available in the button description and successful result. No recurrence is created. |
| Search workflow calendar | Search below the calendar it affects | Search beside calendar controls, with one reset covering search/role/status and selected button state. Local unfinished-list controls remain beside that list. |
| Return from unsuccessful Wiki search | Erase query and search again | Explicit search reset returns to the current folder and focuses search. Unsaved edits require the existing discard confirmation first. |
| Read Wiki without export/archive clutter | Edit, focus, archive and two exports all compete | Edit/focus stay visible; native `その他の操作` disclosure contains rare export/archive actions. |
| Edit a page with very long imported folder names | Tree buttons can overlap and intercept the Edit target | Navigation column clips horizontal overflow and wraps labels within its width; single-column mobile navigation is not sticky over the reading controls. The test uses a normal pointer click, not forced interaction. |

These are task walkthrough improvements, not experimentally measured productivity claims. Date/deadline distinction, independent clones, role registries, review gates, same-data list/board and conflict handling already existed; this change does not claim to introduce them.

## Research informing the choices

- [Things: When versus Deadline](https://culturedcode.com/things/support/articles/2803579/) and [Quick Entry](https://culturedcode.com/things/support/articles/2785159/): optional capture destination, no modal required for ordinary scheduling.
- [Linear board layout](https://linear.app/docs/board-layout): the same filters/data/actions remain available across views; no drag-only action.
- [Notion wikis and verified pages](https://www.notion.com/help/wikis-and-verified-pages): distinguish finding/reading/review without inventing a new verification status.
- [WCAG reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html), and [GOV.UK validation](https://design-system.service.gov.uk/patterns/validation/): keyboard focus, meaningful empty states, retained drafts and explicit save/conflict messages.

## Validation and limits

Synthetic fixtures only. ToDo covers 320/390/1440px in light/dark, no horizontal overflow, compact card bounds, all four clone targets, same-data board, filtering without hiding deadline warnings, reset focus, title-only capture, optional Tomorrow capture, today reschedule preserving deadline, modal/history/conflict/clone retries. A teaching-day screenshot fixture uses parent meetings, lesson handouts, mock-exam explanations and marking tasks.

Wiki covers desktop/mobile, light/dark, long-name tree pointer access, export disclosure, unsuccessful search reset, and cancel/accept of the existing unsaved-input guard. Existing review, restore, source, conflict-retention and keyboard-tab tests remain.

Workflow covers global-filter reset including unfinished-list status and aria-pressed, plus existing desktop/mobile, modal late-response/back, owner/gate/stop tests. Independent local review found the reset-state inconsistency; fixed with regression coverage.

Synthetic IME key events assert cancellation for composing Enter and keyCode229; they do not establish real Japanese IME candidate behavior on every browser/OS. A real-IME manual check remains. Public signed-in browser checks require an available user session; tests do not touch user data.
