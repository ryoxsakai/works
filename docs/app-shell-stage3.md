# Works unified app: stage 3 (local implementation)

## Implemented scope

The optional `/app/` entry now includes materials, admissions and workflow browsing and conservative existing-item editing. The original home and every original URL remain available. Lesson records remain outside this stage.

- Materials: all existing classifications and files, classification-path filtering/search, metadata details, classification-name editing, file name/material-code editing. Folder moves, file previews/downloads/uploads, reordering and deletion remain in `/material/`; no file is shared by this implementation.
- Admissions: existing schedule list/search, detail and source link, university/date/end-date/notes editing. Selection/stage, source attribution and color are retained. Existing calendar/print/advanced operations remain in `/admission/`.
- Workflows: `1. 役割設定`, `2. カンバン`, `3. 確認事項`, with visible global-stop state and owner-review count. Existing role name/responsibility/completion descriptions and disabled, unarchived definition title/purpose/completion can be edited. Operational scopes, assignments, fixed tasks, planning policies, gates and execution authorization are preserved. Authorized definitions, archived roles and Runs cannot be edited here. Approval, execution, claim, pause/resume/stop changes, future planning and history remain in `/workflow/`. The integration does not provide automatic approval or claim actions. Loaded-data limits are displayed (latest 500 Runs/200 definitions); future planning is explicitly delegated to the original screen.

All modules share the existing authentication instance and Framework7 router, clear their private state/DOM on unmount/sign-out, and preserve list preferences only in memory. Deep links, reload and Back/Forward fetch current state. Unsaved input protects navigation, including menu navigation. Pending saves freeze the form and block another submission or route change. Conflicts and uncertain results preserve the draft and offer download/read-back/explicit discard, never automatic resend or rebase. A committed save followed by a list-read failure is reported as a completed save with a failed refresh.

## Navigation and design

Production mobile tabs are exactly **ホーム / 授業管理 / 教材管理 / TODO / メモ**, with icons and permanent text labels. Lesson management opens an explicit original-screen guide. The hamburger opens a native modal containing all original Works functions. Desktop retains the full sidebar and the same modal. URL-derived selection is shared by sidebar, modal and tabs; selected items use background, weight, a marker and `aria-current`.

The modal traps focus natively, closes with Escape/close/backdrop or successful navigation, and restores focus to a current-page opener when dismissed. Failed unsaved navigation leaves the modal and draft intact. Touch targets use 48 CSS px as the design minimum; bottom tabs use 56px, safe-area padding and reserved content-bottom space. Reduced motion is respected. Primary save/sign-in actions are blue-filled; secondary actions stay quiet.

The blue (`#2563eb`), white and restrained blue/lavender gradient are grounded in existing `shared/styles.css`, not an inferred audio implementation. `audio.lrnr.jp` could not be opened by the available web tool; its actual pixels/CSS remain unverified. The supplied logo also remains absent because its authorized Library retry failed before bytes were materialized. No replacement logo was generated.

Reference checklist supplied by the parent after reading [the article](https://note.com/nokowashiyama/n/n8e88250c38e6): related-content spacing; 4/8/16/24/32px rhythm; left alignment; fewer nested borders; visible important features; permanent labels; selected-state cues beyond color; limited primary emphasis; touch target sizing; contrast and responsive behavior. Article pt values are not treated as CSS-pixel standards. Automated computed navigation/save contrast is at least 4.56:1 light and 5.17:1 dark. These checks cover tested elements and do not establish a full WCAG audit.

## API compatibility and rollout

No schema migration, data backfill, deletion, sharing, authentication scope or role/Run permission change is included.

Existing admission/material PUT contracts remain compatible. Additive, same-authenticated `/guarded` PUT routes require a complete `expected` base snapshot:

- `/api/admissions/:id/guarded`
- `/api/material-library/folders/:id/guarded`
- `/api/material-library/files/:id/guarded`

The server compares the base business fields atomically in the SQL UPDATE (`IS ?`, including nulls) and returns 409 if changed. IDs and SQL column names are never taken from arbitrary expected keys. This avoids same-second timestamp races without new DB columns. Old clients can continue their existing requests without `expected`. New clients always use the new routes, so an old Worker responds 404 instead of silently ignoring the concurrency condition. Guarded routes do not support deletion. Workflow edits use the existing revision CAS and existing owner/browser guards.

Before publication, obtain approval for this stage and the navigation/palette change, then create a draft PR and require exact-head unified-app and full Worker/OAuth regression CI. Deploy/verify the additive Worker routes and static assets through the existing release workflows, without assuming that a main merge alone establishes active Worker version. Prefer backend readiness first; a frontend-first mismatch fails to save safely. Rollback of the frontend restores the prior optional entry; rollback of the Worker leaves old endpoints compatible and causes the new guarded writes to fail safely. No saved-data rollback is necessary.

## Validation and remaining checks

All writes used synthetic intercepted API responses or local Miniflare databases. Tests cover role/draft-only payload preservation, atomic concurrent updates, nulls, missing snapshot rejection, HTTP endpoint auth/400/409 behavior, legacy contracts, source URL safety, cyclic folders, lists/details/edits, all-menu reachability, current-route menu dismissal, unsaved cancellation, focus return, native history, repeated mounts, one auth initialization, single-flight saves, uncertain results, empty/read-error/auth-expiry recovery, 320/390/768/1440px widths, keyboard access, bottom-control visibility and light/dark contrast. Existing SS/ToDo/Memo/Wiki/auth/browser regressions are included.

Real signed-in Mac/iPhone QA, soft-keyboard and safe-area behavior on physical hardware, actual audio visual comparison and logo integration remain unverified. Local browser emulation does not establish production acceptance. No PR, push, merge or production publication has been performed for stage 3 while authorization is pending.
