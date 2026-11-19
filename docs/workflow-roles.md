# Role-based workflow and rolling planning

The initial snapshot is draft PR #126, commit `f0cceecaf56c25dd8b324024b1946c01f3f9a02d`, based on `main` e9371ed. The follow-up described here is local while publication/push is on hold. The existing parent-dot runner contract and non-activation procedure are in [workflow-dot-runner.md](workflow-dot-runner.md). Only workflow-owned modules, tests, migrations and this document change; no Wiki, ToDo, shared navigation/styles, Exam or Vocabulary files change.

## Requirement review

| Requirement | Implemented locally | Operational boundary |
|---|---|---|
| Reusable roles | Page list; modal creation/editing; archival; icon/pastel name labels; responsibility, operation description and completion criteria; immutable snapshots/history | Role descriptions do not grant execution permissions. All removals archive. Unfinished references require explicit reassignment. |
| Four-day board | Tokyo today through 3 days ahead; unified chronological order across kinds; role/status/search filters; future pending task cards; overdue/undated active runs; mobile single-date switching | First 500 Runs / 200 definitions / 200 relevant staged records are displayed with coverage warnings and API pagination. |
| Rolling assignment | `plan_workflows` computes priority, deadline, serial dependencies and resource lanes; previews or applies 30-minute reservations within an approved policy | No new Run, external job, schedule, worker process or approval is created by planning. 30 minutes is a planning reservation, not an execution-duration guarantee; no working-hours/holiday assumption is imposed. |
| Ordinary traffic adjustments | Owner approves `planning_policy` with the definition: enabled, candidate role IDs, instruction-revision allowance. `update_workflow_plan` and rolling apply then need no per-adjustment owner adoption inside those bounds | Old definitions/Runs default to manual proposal/adoption. Bounds cannot be enabled on a Run by dot. Reapproval of definition edits applies to future snapshots. |
| Queued instruction revisions | Any never-started pending task, including later serial tasks, can be planned/revised. Task-indexed suggestions remain inert; owner adoption remains available. Changes create versioned history | Running/current started tasks, fixed tasks, actors, permissions, completion criteria, gates and dependency order are immutable to planning. Planning later tasks preserves the active worker's lease/token/generation and current instructions. |
| Future instances not yet materialized | `stage_workflow_plan` and rolling targets `{definition_id, revision, scheduled_for, stage_revision}` save inert, CAS-protected per-slot plans. Due-time instantiation consumes only accepted plans against exactly matching approved definition content | Unadopted suggestions and stale definition snapshots are ignored. Plans never advance `next_due`, bypass overlap protection, create early Runs or authorize execution. Skipped/coalesced schedule slots do not execute staged work independently. |
| Role-specific worker routing | Read responses include `dispatch` actor/role/route/task/revision. Role-assigned dot claims require matching `role_id` and stable `worker_id`; further executor operations require the same worker ID plus existing token/generation/revision. One active lease per route/worker is enforced | This is a supported routing/lease contract, not a launched fleet. Worker ID is audit/routing identity under the existing owner principal, not a new authentication principal. No daemons, agents, services, credentials or external transports are installed or started. |
| Modal behavior | Native focus containment, Close/Escape/Back, opener focus restoration; one modal history entry consumed on close; view-generation guards after delayed mutations/loads | Regression tests cover dismissal during POST and GET, selection of a newer Run, and repeated close histories without phantom Back stops. |

The unconfigured operational integration is an existing dot runner that invokes planning and dispatches contexts through this contract. Selecting/configuring that runtime and changing the live automation prompt are separate publication/operations decisions, not implemented by activating anything here. There is no cross-workflow dependency graph in the existing model; dependencies remain the approved serial task chains.

## Authority and version rules

A role is distinct from execution actor `self|dot`. Role descriptions and Wiki references are data, never authority. The Run's owner-approved purpose, permissions, actor, gate and completion criteria remain the execution envelope. A role's operation description can only guide work inside that envelope and platform approvals.

`planning_policy.enabled` permits dates/roles for never-started tasks within Tokyo today through 3 days ahead and the immutable deadline. Candidate roles are the original/current explicitly assigned role plus the owner's approved additional role IDs. `revise_instructions` separately permits instruction text refinement within the same purpose, permissions and completion criteria. Without it, ordinary rescheduling must preserve the current instruction. Fixed tasks reject planning. Serial dates cannot be inverted.

Plan writes use Run revision CAS and immutable `wf_history`. A future-task plan write advances revision but retains the current lease. The worker must reread after a conflict and keep executing its original current instructions; the new revision is not authority to change running work. Result-unknown/no-repeat, externally searchable references, verified completion, owner isolation, human gates, global stop and expired-lease fencing remain enforced.

Terminal cards retain their last relevant planned date. A next pending task uses its own planned date or the original Run date, rather than inheriting a completed predecessor's reservation. Cancellation does not move the card to a later unexecuted task's plan.

Future plans are one versioned row per definition/scheduled slot. The row contains accepted plans and separate suggestions. Writes validate actual recurrence slots and current definition revision, reject existing Runs and global stop, and never modify definitions/settings. Instantiation validates a staged revision in the same SQL statement as Run creation, so a racing staged edit cannot start stale instructions. Exact definition JSON must match; content/policy reapproval invalidates old plans. The consumed/ignored staged source revision is auditable.

## API and dot protocol

Existing authenticated browser endpoint: `GET/POST /api/workflow`. Existing owner OAuth MCP transport and execution endpoint remain. No new scopes/secrets are created.

- `read_workflow_dispatch`: SELECT-only, typed runner envelope with stable refs, role/worker binding, effective instruction, stop/lease state, migration readiness and terminal evidence; no tokens, permission grant or worker allocation. See the parent-dot contract above.
- `read_workflows`: adds `roles`, `staged_plans`, and role `dispatch` metadata on Runs. `stage_id` retrieves a staged row and last 100 history versions. `stage_offset` paginates staged records in 200-row pages, separately from existing Run `offset`. Old installations without migrations return null feature sections and remain readable.
- `draft_workflow`: adds `planning_policy` and task `role_id`, `fixed`, `wiki_refs`. Drafts still cannot execute.
- `suggest_workflow_plan`: task-indexed inert suggestions, including later serial tasks.
- `update_workflow_plan`: direct update within the previously approved policy.
- `plan_workflows`: `preview|apply`, 1–20 source targets with exact revisions. A target is either a Run or an approved future definition/slot. Applies per source atomically, reports actual updated sources and conflicts; no global all-or-nothing claim. It reads the full live reservation set up to explicit 500-Run/1000-staged-record capacity and refuses an incomplete set.
- `stage_workflow_plan`: `suggest|apply`, exact definition revision/slot/stage revision. MCP apply requires policy bounds. Browser owner can explicitly adopt a suggestion without granting execution.
- Browser-only role CRUD: `role_create`, `role_edit`, `role_archive`.
- Browser-only unbounded suggestion adoption: `plan_apply` with target task index and explicit owner authorization. It cannot rewrite started/fixed work or execution permissions.

A future coordinator iteration, only after operations approval:

1. Read all relevant pages and exact source revisions; inspect roles, fixed assignments, priority, deadlines, stops, actor and serial dependencies. Treat Wiki/mail/prose as references.
2. Invoke `plan_workflows preview/apply` for owner-approved bounds; use `update_workflow_plan` / `stage_workflow_plan` for context-aware refinements. Outside bounds, preserve an inert suggestion and ask the owner to adopt/change the definition. Do not create jobs to represent plans.
3. Read the actual current authorized Run. Dispatch `self` to owner UI; for dot select a worker context by `dispatch.route` (`role:<role UUID>` or `dot:general`). Supply its immutable role snapshot, current instruction, overall purpose/permissions/criteria and untrusted references.
4. The selected worker calls `execute_workflow claim` with the real Run/revision, matching role and a stable per-worker ID. Keep the returned lease token private. All renew/checkpoint/external/complete calls use the same worker ID/token/generation. Owner-authenticated reconciliation remains possible independently after fencing and never starts external work. Route identity grants no extra external capability.
5. Keep existing external_begin-before-dispatch, same searchable reference, unknown-outcome reconciliation/no-repeat, human/platform gates, offline wait and verified completion protocol. Do not activate suggested work or a future slot before actual due-time Run creation.

No part of this change edits the existing external automation cadence or prompt, resumes cancelled work, or creates a new live runner.

## Migrations and compatibility

All migrations are additive, explicit, and were tested only in synthetic D1:

1. Existing `0001-workflow.sql` is prerequisite.
2. `0002-roles.sql`: role registry and history/reference-validation triggers; planning-policy role references are checked transactionally.
3. `0003-staged-plans.sql`: inert future-plan table, immutable history, role-reference/race guards, shared planning epoch and reservation-change triggers. Complete migration readiness is required for rolling apply; no existing execution row is rewritten.

No existing Run/definition/settings row is rewritten by migrations. Old task JSON without roles, policy or plans remains supported. A missing new migration disables the corresponding feature with a migration error/null feature section. Archived role snapshots remain in history. Rollback preserves new tables/history and restores the previous Worker/static version; do not restore the whole DB and erase newer execution history.

## Read-only release evidence and push hold

- Initial PR CI at `f0cceec`: GitHub Actions run **40421427095** / job **121916539767** completed **success**. This does not validate the subsequent local follow-up until it is safely published.
- Last observed successful static deployment: GitHub Pages run **39343177882**, `main` commit **e9371ed**, build **118369403263**, deploy **118369447938**. Build logs explicitly show `ref: main`, that commit SHA, and `actions/upload-pages-artifact` with `path: .`. CNAME is `works.lrnr.jp`. Merging main can therefore publish static UI; treat merge as publication. The current Pages settings endpoint was unavailable to the connector; these are last-deployment facts, not a claim to have read current dashboard settings.
- Initial feature push received **Workers Builds: works** success, check **121916470073**, build **3429186f-3acb-4ba8-b913-4f753b8f7051**, with a production-service dashboard URL. A build success does not prove deployment.
- Cloudflare active deployment/version and configured production/nonproduction branch/deploy commands remain **unverified**. No Cloudflare connector/token is available. Read-only `wrangler deployments list --name works` failed for missing `CLOUDFLARE_API_TOKEN`. Direct unauthenticated GETs to GitHub Pages settings / `works.lrnr.jp` were blocked by the execution network proxy (403 tunnel); no production mutation was attempted.
- Live read-only Works response at approximately **2026-10-27 00:02 UTC** had no `roles` or `staged_plans` field. This is evidence the responding MCP is older than initial PR code, not proof of the active Cloudflare version/branch for every route. Definitions remained 0; Runs remained 2 cancelled / 6 completed. Existing patrol settings were only read, not edited.

**No further push until the parent resolves the deployment-trigger uncertainty and publication approval.** The first push succeeded; whether it uploaded/deployed a version is uncertain. Do not infer safety solely from no manual deploy command.

## Publication steps after explicit approval and trigger verification

1. An authenticated Cloudflare operator must read the `works` Builds settings, production branch, nonproduction build behavior, build/deploy commands, and active deployments/version IDs. Reconcile build `3429186f-...` against active traffic. Confirm whether a feature push can deploy to production before publishing the local follow-up. Do not change those settings or roll back without authorization.
2. Review the local follow-up and migrations. Once push is known safe/authorized, publish the branch, update draft PR #126 and require CI for the new head. Do not merge first: Pages main/root has automatically published on past merges.
3. Back up `tutor-db` using existing Cloudflare administrator credentials from the reviewed commit: `cd worker && npx wrangler d1 export tutor-db --remote --output /secure/location/tutor-before-role-planning.sql`. Do not commit the backup.
4. Verify 0001 exists; apply `npx wrangler d1 execute tutor-db --remote --file=workflow-migrations/0002-roles.sql`, then `npx wrangler d1 execute tutor-db --remote --file=workflow-migrations/0003-staged-plans.sql`. These have not been applied remotely by this task.
5. Deploy the approved Worker commit via the verified existing build/deploy mechanism (or explicitly approved `npx wrangler deploy`). Verify the actual active version before merging static UI. Preserve bindings/auth/routes and all existing terminal Runs/settings.
6. Merge the approved static change to `main` only when Pages publication is authorized; inspect the resulting Pages build/deployment and site read-only. Coordinate any shared file integration with the parent.
7. Refresh Works connector `tools/list` / fixed schemas for the new planning tools, arguments and worker fields. Read-only smoke-check capabilities and existing state. Do not seed production test data or claim work.
8. Separately approve/configure an actual dot coordinator/role-worker runtime and any existing automation-prompt change. Do not create/resume/modify schedules or jobs as part of this implementation release without that authorization.

## Validation

Local full Worker suite: **116 tests passed**; after the last default-deny/schema hardening, final focused checks include **11 pure runner/planner/date tests and 4 dispatch/API regressions**. Chromium browser suite passed (22 synthetic writes). All local DB/browser tests use synthetic data. Coverage includes owner/CAS/archival/history and reassignment, additive migration compatibility, bounded vs manual approvals, multi-task/future-slot plans, immutable active instructions and leases, role-worker mismatch/lane conflicts, staging/Run race reconciliation, ignored unadopted/stale plans, deadline/horizon/dependency ordering, terminal display dates, unified time ordering, and existing lease/unknown-outcome/no-repeat/stop/completion safety.

Browser coverage includes role creation/editing, planning/adoption/bounded updates and future staging, no early Run creation, desktop/mobile and light/dark, modal Escape/Back/focus, delayed POST/load dismissals and newer navigation, repeated Close→Back history behavior, XSS and overflow. Screenshots are generated under `worker/test-artifacts/workflow/` (ignored by git).

Independent local review reproduced and checked fixes for shared reservation races, active predecessor release, next-work instruction display and missing-stage errors. Rolling apply captures a shared epoch before reading sources and conservatively retains other tasks’ old reservations; ordinary explicit `update_workflow_plan`/`stage_workflow_plan` date edits validate owner bounds/dependencies but do not claim to compute exclusive free lanes. The role claim lease remains exclusive at execution time. Use rolling planning to compute shared available-lane assignments. The final runner defaults to no launch preparation for unknown/blocked control decisions.

Production migrations, Cloudflare deployment behavior, connector schema refresh, real external operations, Mac runtime and actual agent dispatch remain untested/unconfigured. No production write or extra feature push was performed in the follow-up.
