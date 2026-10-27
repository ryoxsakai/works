# Personal ToDo redesign and independent future clones

Base: `main` fetched on 2026-10-26, commit `e9371ed19ae929ff97915a4938c27609390dcf71`.
Local branch: `feat/personal-todo-future-clone`. No push, PR, merge, remote migration or deployment is part of this task. All test tasks, roles, categories, tokens and databases are synthetic.

## Behavior

- Title-only capture adds an unplanned task. The default vertical list shows about three suggested focus tasks, the remaining today/carryover tasks, future planned days, an unplanned inbox and completed history. The status kanban presents the same task IDs, without making copies. Status changes and rescheduling are available in Details.
- The deadline guardrail shows **all** unfinished overdue/next-seven-day deadlines, independently of role/category filters or focus suggestions. Planned day is separate from the hard deadline. Carryover never changes either field automatically.
- Personal hats have stable IDs, names, five pastel colors, six icons and an archive flag. Text plus icon accompanies color. Existing task assignments survive archival and renaming. Assignments can be changed in Details; an archived role is not offered for new assignments. Roles cannot be physically removed through the API.
- Existing categories remain a separate registry. Their filter, add/rename/reorder/delete and explicit reassignment UI remains available. Renaming updates category links; deleting a used category requires choosing and confirming a destination. This does not modify role assignments.
- Details offer optional planned day, deadline, state, importance marker/detailed level, task-only memo, reusable description and checked steps. Legacy numeric progress is preserved and displayed where relevant; explicit status changes update it for older clients. Completion happens only by explicit interaction/API request, never from age.
- Each task has fast 1/3/7/14-day clone buttons with an exact Tokyo date. Custom day/week offset and an explicit optional new deadline are in a separate dialog. The fast action uses the operation's Tokyo today; the custom dialog freezes its initial Tokyo day. Pending/result UI displays the exact target day, including after a midnight boundary.
- A clone is a new independent task with `cloneSourceId`. Source data is unchanged. New status/progress/checks/completion timestamps are reset. Title, category, role, importance and checklist text survive. Only the explicit reusable description is copied; legacy memo, execution history and completion notes are excluded. Same-owner links/attachments retain only references (string or `id`/`url`/`object_key`), not embedded payloads/history. No background recurrence is created.
- Native dialogs support keyboard focus containment, Escape, outside click and browser Back, with focus return. Dismissal while a request is pending does not cancel the committed operation or reopen/close a later dialog. Request controls are disabled while pending, while close remains available.

## Storage and compatibility

The existing `todo_state(id=1, data, revision)` table remains unchanged. **No new SQL migration is required** when the current main schema is already installed. Reads/writes add JSON fields without initializing or replacing real tasks/categories:

- Document: `roles`, `cloneRequests` (server-controlled durable receipt map).
- Task: optional `roleId`, `plannedDay`, `status`, `important`, `checklist`, `reusableDescription`, `completedAt`, `cloneSourceId`.
- Legacy fields (`id`, `name`, `category`, `priority`, `deadline`, `progress`, `memo`, `createdAt`) remain valid. Missing roles read as `[]`; no existing category is converted into a role.
- Writes missing `roles` preserve the current registry. Client-supplied operation receipts cannot replace server receipts. Whole-document compare-and-swap rejects stale revisions with 409; no automatic last-writer overwrite occurs.
- An old worker implementation would discard the new document-level metadata on its next save. Any later rollback must retain the forward-compatible ToDo serializer/receipt handling or restore an owner-approved backup; simply rolling the worker back is not a safe data-preserving rollback. This task has performed no production rollout or backup.

Clone receipt and task insertion occur in the **same** revision-guarded SQL update. Concurrent identical requests reconcile against the committed receipt. Receipts have no expiry: deleting a clone does not permit the same request ID to recreate it. A deliberately later clone gets a new UUID. The existing 10,000-task and 200-category limits remain; roles are limited to 200 and steps to 200 per task. No automatic receipt cleanup is introduced.

The browser records only pending clone arguments in localStorage before dispatch. After an unknown response or reload, it looks up the receipt first and retries the identical operation if absent. Network failures never silently generate a new request ID. Recovery returns the original result snapshot; the browser reloads current state afterward.

## API / conversation connector

Browser endpoints remain behind the existing verified, single `ALLOWED_EMAIL` owner session. Other email accounts, invalid sessions and MCP bearer tokens cannot access browser endpoints. This is the existing single-owner Works model, not a new multi-tenant storage model.

- Existing `GET/PUT /api/todo` and legacy task fields remain.
- `POST /api/todo/clone`: `{id, request_id, base_day, offset_days, deadline?}`. `request_id` is 16–100 ASCII letters/digits/underscore/hyphen; `base_day` is Tokyo's initial-request day; offset is an integer 1–3650. Deadline defaults to null. Identical requests return the original committed result; changing arguments with the same ID returns 409.
- `GET /api/todo/clone?request_id=...`: result snapshot, or `{found:false}`; no creation.
- `list_todos` still returns `tasks[]` and `categories`, plus `roles` and `revision`. Optional category/role filtering does not change stored data.
- `update_todo` / `delete_todo` now require `expected_revision` from a fresh list, plus exact stable task ID. Role/category replacements also require that revision when writing. This intentional connector contract tightening prevents conversation-based stale edits; read-only registry calls remain supported.
- `clone_todo`, `get_todo_clone_result`, `manage_todo_roles` expose the same semantics. Keep the exact clone arguments/request ID after an unknown outcome; call `list_todos` after recovery because the receipt is an earlier snapshot. Tools describe owner hats, reusable descriptions, deadline separation and no inferred completion. They do not configure or claim automatic monitoring.

## Local validation

Run from `worker` (the browser test also resolves its fixture root correctly from the repository root):

```sh
npm ci --cache /tmp/works-npm-cache
npm test
node test/todo-personal.browser.mjs
node --check ../todo/todo.js
node --check src/index.js
git diff --check
```

Browser prerequisite: system Chromium at `/usr/bin/chromium`, or `CHROMIUM_PATH=/path/to/chromium`. The fixture starts an ephemeral local HTTP server and Miniflare D1, serves a synthetic auth module/token, and uses the actual Worker ToDo routes. No real Google login, API, categories or tasks are used.

Results:

- Aggregate `npm test`: **98 passed, 0 failed, 0 skipped** (final backend including reference allowlist/validation).
- Six ToDo unit/integration tests include legacy revisions, category preservation, malformed additive values, role archival, planned-vs-due separation, JST/leap/month/year boundaries, completed/pending sources, checklist reset, reference-only attachments, private-history omission, three concurrent identical requests, result lookup/response-loss retry, idempotency conflict, intentional distinct clone and owner/token isolation.
- Browser: **320/390/1440px × light/dark = six scenarios**, including input foreground/16px text, no list/board overflow, focus suggestions vs all tasks, deadlines outside filters, same-data kanban, modal focus/Escape/back. Additional end-to-end cases cover category add/rename and task links, role archive/reassignment, title-only capture, reschedule preserving deadline, disabled pending controls, repeated clones, completed-source/checklist reset, forced response loss with reload/result recovery, custom weeks/deadline, delayed dismissal and operation-day Tokyo midnight rollover.
- Syntax and `git diff --check`: pass.

The old shared `category-ui.browser.mjs` fixture targets the replaced ToDo table/inline-handler DOM and was not run as a redesigned-ToDo acceptance test. The new dedicated browser suite covers the retained category behavior with the new DOM. Other service browser suites were not rerun; shared UI/Wiki/workflow files are unchanged. Safari, Firefox, physical touch devices, screen readers and live owner data/deployment are unrun.

Screenshots are generated under `worker/test-artifacts/todo-personal/`: `{320,390,1440}-{light,dark}.png`, `*-board.png`, and `*-detail.png`. They are local ignored artifacts, not publication. Logs are kept alongside them when copied from `/tmp/works-todo-*-final.log`.

## Integration boundary

All UI changes are under `todo/`; tests and this document are ToDo-specific. The only shared implementation edits are in `worker/src/index.js`:

1. The `// Personal ToDo document` block replacing the old ToDo helpers/tool definitions immediately before `export default`.
2. Two `/api/todo/clone` routes beside the existing `/api/todo` routes, after browser-session verification.

No Wiki/workflow modules, shared CSS/auth/header files, schema SQL or package metadata are changed. Coordinate those index.js regions with sibling work before integration. Publication remains separately pending; no push/PR/merge/deploy should be inferred from local validation.
