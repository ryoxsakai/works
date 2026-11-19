# Workflow original-feature parity

Baseline: main `4b9dc321b35cbbf6aca854d059b342c70643b286`. Source inventory is code-based; user attachment pixels and actual iPhone are unverified. Original `/workflow/`, `/workflow/roles.html`, data and APIs remain available.

## Exact source inventory and acceptance

| Source | Original interaction and acceptance |
|---|---|
| `workflow/index.html`, `steps.mjs` | Numbered role/board/checks steps; initial empty-state wizard, back/next/cancel/resume; session navigation preference only. Advancing guide never creates, publishes or starts work. Supplementary dialogs, focus return, dirty-close and route-leave protection. |
| `workflow/roles.js`, `roles.html` | Create/edit responsibility, operation scope, completion, icon and color; archived list; archive explicit confirmation and server rejection of unfinished/draft references. No manual role reorder or unarchive control exists. Role registration grants no execution permission. |
| `workflow/app.js` taskEditor/openEditor | Definition name/kind/priority/purpose/completion/permissions; JST start/deadline; once/hourly1–8760/daily/weekly recurrence; planning policy enable/allowed roles/instruction changes. Serial tasks add/remove (in insertion order), title/completion/role/fixed/wiki references/assignee/gate. No manual task reorder exists. Default gate true. Draft Save is not publish. |
| `app.js` definitions | Edit only disabled drafts; stopping future schedule precedes edit; versioned edit requires new authorization. Archive only disabled definitions, preserve history. Explicit full-content execution-authorization confirmation, then separately manual start with stable request key. Never synthesize authorization from content. |
| `app.js` render/runCard, `planning.mjs` | Calendar/agenda, JST day/previous/next/today, PC4 days/mobile1 day, title/purpose query, role/status filters and clear. Pending future tasks and not-yet-instantiated schedule slots distinguish planned from Run. Original hourly/day/weekly exclusions and chronological order, last task terminal date, role snapshots, overdue/progress/next-work/status. |
| `app.js` checks/renderRun | Checks list independent of board filters; all unfinished/past/undated/review/running. Run detail, task evidence and Wiki refs, stop reason and external reference JSON; history immutable snapshot text. Explicit pause/cancel/resume/approve/self-complete only in original permitted states; criteria checkboxes unchecked until user input; cancellation confirmation warns external operations cannot be undone. Server retains final authority. |
| `app.js` futureDetail/planning | Future preview creates no Run. Suggestion differs from accepted allocation; frozen definition/stage/run revisions and task index. Fixed/completed/current executing tasks immutable. Apply within previously approved policy only; explicit reviewed adoption uses authorized flag only after user confirmation. Rolling preview/apply up to20 sorted targets; conflicts shown, never dispatch work. |
| `app.js` settings/global stop | Desired30/60min separate from actual/last heartbeat; mismatch shown. Saving desired interval never changes an external schedule. Global stop/resume explicit confirmation; resume_all never resumes individual Runs. External in-flight/unknown remains waiting and must reconcile same reference; terminal Runs cannot reopen. |
| `worker/src/workflow*.js` | Browser mutations use owner session and same-origin JSON; all revision checks remain. Lease/generation fencing, role constraints, planning epochs, external refs and start idempotency stay server-owned. No UI call to execute/claim/patrol/external_begin/checkpoint. Backend/schema unchanged. |

## Migration and safety additions

Scoped original controllers/template/CSS reuse existing shell auth and `/api/workflow`; original standalone scripts are unchanged. Framework7 remains sole router. Shared mutation guard serializes role/definition/run writes. Unknown/conflicting/inconsistent replies stop further writes, preserve input/operation references, permit read-only inspection and export, then explicit fresh-read/discard. A successful mutation followed by failed refresh also stops; inspection never replays. No inferred aliases, content-based approval or automatic schedule installation.

## Current status

- [x] Source feature and server safety inventory.
- [x] Native controller/dialog/steps/roles implementation and original form constraints ported.
- [x] Native definition/task/calendar/checks/planning/settings controls ported; source ordering/recurrence helpers reused.
- [x] Actual isolated-D1 synthetic mutation, conflict, unknown-result and authorization regression.
- [x] Router/deep link/reload, same-document Back, dirty/busy, keyboard/focus/mobile validation; shell theme regression passed.
- [x] Original Workflow browser regression and all15 final shell browser suites pass.
- [ ] Exact-head CI, draft PR, merge and deployment verification.

No production Workflow/settings/automation changes are used for tests. Remaining overall modules: material library, admissions, native KDP, SS audit, and explicit safe lesson-alias mapping. This checklist does not declare full migration complete.

## Verified implementation details

`prototype/workflow-module.mjs`, `workflow-roles.mjs`, `workflow-steps.mjs` and `workflow-view.html` scope the original controls to each mount. The browser-owner action allowlist excludes claim/patrol/checkpoint/external dispatch. Every mutation freezes its revision/body, binds response identity/version/action shape, and uses one shared guard across roles and runs. Source manual-start keys are retained until acknowledgement. Server lease/generation/owner/terminal/external-outcome checks remain unchanged. Text and history use textContent; unsafe legacy artifact/reference URLs remain inert text.

Known validation errors retain correctable input; CAS/unknown/bad acknowledgement stops all snapshot mutations. Recovery exports the held forms, source state and request/reference; read-only inspection never replays. Explicit fresh-read/discard is required to restart. Acknowledged-definition-save/list-refresh failure retains the open editor and receipt, avoiding duplicate creation. After a successful refreshed Run, the dirty baseline is updated so server-driven layout changes do not create a false unsaved warning. Switching planning tasks asks before discarding draft instructions or result/verification input; allocation Save similarly protects unsaved result input.

Native dialogs remain scoped native top-layer dialogs. Escape/Close preserve dirty confirmation and opener focus; scroll locking survives nested dialogs. The shell handles same-document Back through an optional module child-view hook, closing the top dialog before navigating and restoring the stamped URL entry without a second router. A direct entry leaving the document follows normal browser navigation; beforeunload protects dirty/pending/unknown content. No standalone modal history listener or second history router is installed.

Synthetic coverage includes empty/resumable navigation-only wizard, complete role create/edit/archive, draft create and separate explicit publication, manual-key acknowledgement, pause/cancel/resume and terminal/global-stop isolation, both independent self-completion verification gates, original independent filters/agenda, desired-versus-actual interval, stale settings, committed-but-lost creation, acknowledged save/failed refresh, staged suggestion versus applied future allocation with no Run creation, read-only rolling preview, dirty planning selection, responsive dialog geometry/focus and native menu/Back handling. Existing Worker35 tests cover lease/external reference/ownership/serial/planning epochs and idempotency; the original desktop/mobile browser regression passes. Production records and external schedules are never used as fixtures.

No Worker/schema change, new dependency, permission or credential change. Rollback is the previous frontend tree; original `/workflow/` is retained and all APIs remain backward compatible. Actual iPhone, authenticated production controls and user-attachment pixel comparison remain unverified. Local synthetic390px role/board screenshots were inspected; a stretched close button was corrected and its width is asserted.

The first exact-head CI passed the new native Workflow suite but exposed an existing rapid drawer race in Chrome153: Framework7's delegated backdrop handler could start an animated close before the controller's synchronous handler, releasing visible state while `allowOpen` was still false. The panel now disables the duplicate Framework7 backdrop-close handler; the existing controller alone owns backdrop/Escape closure. Animated opening, left-drawer design, focus/inert locks and breakpoint behavior remain. The regression asserts that ownership and20 rapid open/close cycles; no retries or sleeps replace assertions.
