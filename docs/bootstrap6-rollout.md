# Bootstrap 6 staged legacy UI rollout

Scope: old root menu and then old pages, not the paused integrated app. PR157 and its SQL are untouched. No database, API, auth, permission or production test data changes. Current branch starts from published main 7713fdb017370482415092ca097b424b031774ba. The initial draft-only boundary was superseded by explicit user authorization on 2026-10-30 for separate tested legacy-page PRs and phased releases. No PR approval review is included.

## Resumable stage ledger

These are work batches, not an external automation or a promise of unattended scheduled execution. Finish and record a batch's tests before starting the next; public release requires the parent's instruction.

| Batch | Scope / completion condition | State |
| --- | --- | --- |
| 1 (first 2–3h) | Fixed source/dependencies, common tokens/SVG registry, menu component proof with actual rendered rules and no global CSS leakage | Implemented; synthetic checks pass |
| 2 (next 2–3h) | Whole menu uses selected official components, existing layout/edit/storage/auth/URLs maintained; mobile/desktop, dark, print, cancel/drag/reentry tested; draft PR | PR159 created after new explicit authorization; current head64629527024b60fca0fc0eccd3b7a1e373d48c00 under exact-head CI |
| 3 | SS representative page: original controls/status/table/print preserved | PR160 merged07ebe561f6eef1f5058dd16cff91c2a1b70989b8; Pages/Cloudflare succeeded |
| 4 | ToDo, then KDP and Wiki, one reversible page at a time | ToDo implemented/tested on feat/legacy-todo-bootstrap6; KDP/Wiki not started |
| 5 | Memo (compiled utilities/dynamic classes), admissions (print/calendar), materials (native file drag/drop) | Not started |
| 6 | Workflow/roles and tutor last: ownership, execution gates, blur autosave, attribution/conflicts and print | Not started |

The detailed prior design remains `/workspace/works-bootstrap6-plan.md` (local design handoff); this repository ledger is the durable progress record. Future work must inventory original behavior rather than reuse the paused integrated UI.

## Fixed sources and component decisions

Build: `npm ci --prefix shared/ui --ignore-scripts && npm run build --prefix shared/ui`.

- Bootstrap **6.0.0-alpha.1** (not v5), Sass **1.103.1** (the release's required modern `if(sass(...))` syntax; older 1.93 compiler failed and was replaced before any release), PostCSS **8.5.6**. Exact dependencies and integrity locked in `shared/ui/package-lock.json`.
- Bootstrap Icons **1.13.2**: allowlisted local inline SVGs; icon controls keep accessible names, decorative SVGs have `aria-hidden` and no focus. Existing icon-key names map centrally to meaning in `shared/ui/build.mjs`; static hydration preserves IDs/hidden attributes used by auth. No icon font/network request remains on this menu. Other pages retain their existing icons.
- Tabler **3.50.0** is pinned as build-time fallback only. Every current menu meaning is covered by Bootstrap Icons, so no Tabler SVG, duplicate font or runtime library is shipped. Add a documented semantic exception only when needed.
- Official source modules Nav (`nav/nav-link`), Button (`btn-outline`, `btn-solid`), Card, Alert and Checkbox (`check`) are compiled. CSS is actually applied, not hidden behind legacy rules; a browser test disables the bundle and verifies the card's layout changes.
- Nav: all nine old URLs plus home, same desktop column/mobile native disclosure, current-location marker preserved. No integrated routing or iframe.
- Buttons: actual edit/save/cancel/reset/retry/header controls use v6. 44px target and existing blue/white palette, inherited Japanese font retained; disabled/hover/focus covered.
- Cards: real widget sections use Card while retaining original padding/grid/order. No hidden content, internal scrolling or altered deadline semantics.
- Alerts: persistent loading errors/layout feedback keep existing live-region and retry behavior; no dismiss JS, fake progress or transient-only critical errors.
- Checkbox: actual shortcut preferences use official `check` on the native input; native label and same save path preserved.
- Settings remains a native dialog with the existing focus-return/Escape handler, and mobile navigation remains `details`. Neither needs a second Dialog/Drawer controller. No tabs are invented for a single theme section. Future dialog replacement must separately prove focus/Back/dirty behavior.

## Isolation, theme and runtime budget

`shared/ui/menu.scss` selects source modules only: no Reboot, typography reset, full utilities, JS bundle or peers. The build scopes every selector to `.dashboard-home`, fails on unreviewed root selectors, and flattens layers only inside this generated isolated bundle. This explicitly handles legacy unlayered CSS precedence. No shared global stylesheet is edited. The generated root variables live on the menu body, not `html/:root`; legacy theme remains sole owner. `menu-tokens.css` maps official unprefixed source tokens to existing brand/theme variables and inherits the parent's color-scheme (including explicit light on dark OS and the reverse). Existing M PLUS 1p stack is unchanged.

Runtime additions: local generated CSS (~69.5KB uncompressed before transfer compression), SVG module (~8.5KB); no new Bootstrap/AutoAnimate/Motion runtime JS. Build packages are development-only, ignored node_modules are not committed. Licensing files for Bootstrap/Icons/Tabler are retained.

Animation ownership: existing local SortableJS1.15.6 alone owns outer grid transform/order. Up/down buttons remain. Dynamic reduced-motion updates the current instance to zero duration. Before print it destroys the instance; after print it reinitializes only a still-active editor. Pending import is fenced against printing/pagehide; cancel/logout/pagehide destroy it. New AutoAnimate is deliberately deferred: existing summaries rebuild `innerHTML`, so enabling it would animate replacement rather than stable item changes. Motion has no necessary role in this stage's native disclosure/dialog; neither library is fetched. No animation completion triggers persistence.

## Verification and rollback

Synthetic fixtures only; no production record, file, setting, task or calendar write. Existing dashboard suite tests lazy GET-only APIs, optional catalog, all URLs, deadline semantics, independent retry, delayed logout, timeouts, storage failure/isolation, reset/cancel/reload and real desktop/emulated-touch drag. New tests validate all generated selectors are scoped, official component presence, no reset/remote JS, SVG allowlist and hydration identity, dynamic reduced motion, opposite OS/explicit themes, print destroy/reinitialize, cancel lifecycle and real component application. Matching 320–1920px, edit/light/dark screenshots and print PDF are CI artifacts; screenshot font fallback is recorded, not claimed to be the live webfont. CSS proof and menu-wide adoption are tested together in this isolated branch.

Draft PR CI must rebuild deterministically and run the dashboard + existing OAuth/legacy regression suites on the exact final head. Review actual desktop/mobile and dark/edit pixels; no overlap or horizontal overflow accepted. Actual iPhone Safari18+, live OAuth production session, external font delivery and physical printing remain unverified. Browser floor of Bootstrap6 is Safari/iOS18, Chrome/Edge130, Firefox132; alpha use is explicitly accepted, no stable-release waiting gate.

Rollback: revert this PR's root menu references/markup/controller imports and its generated assets together. No DB rollback/migration or data rewrite. Existing layout v1 storage contract is unchanged; user ordering survives rollback. All old feature pages and paused branches remain usable.

## Official guidance read (2026-10-29)

The personal build-web-ui skill plus ui-ux/integration references were read. Official AI index links were followed, then the actual skill files read via their linked repository's raw source after the web viewer could not fetch the directory pages:

- https://getbootstrap.com/docs/6.0/getting-started/ai/
- https://github.com/twbs/bootstrap/tree/main/skills/bootstrap-v6-install
- https://github.com/twbs/bootstrap/tree/main/skills/bootstrap-component
- https://github.com/twbs/bootstrap/tree/main/skills/bootstrap-color-system

These current guides were checked against the pinned npm alpha.1 source itself (tokens/class names), rather than copying v5 APIs or assuming main matches a future release. Source modules and npm integrity are the reproducible implementation authority.

## First menu batch local results

- 12/12 node tests passed; 20/20 synthetic Chromium browser groups passed. The new contrast test measures rendered primary-button text at >=4.5:1 in both themes using canvas conversion for modern CSS colors.
- Existing synthetic OAuth browser consent/logout regression passed. Existing header/theme multi-page regression is tracked separately in CI.
- Actual pixels inspected: desktop all six widgets, mobile default and editor, desktop/mobile dark. All nine original links, 320–1920px overflow checks, focus hit tests, mouse/touch ordering and cancel pass. Print PDF generated; physical output is not verified.

## Publication blocker and independent SS batch (2026-10-30)

Menu draft PR creation to ryoxsakai/works was rejected by automatic approval review: explicit user authorization for external GitHub sharing was deemed insufficient. The operation did not execute, no PR exists, and it has not been retried. Existing push f89d0a528810644c4592da0b367938519e1be74c remains unchanged. Parent is seeking explicit authorization; no merge/deployment attempted. Main remains 7713fdb017370482415092ca097b424b031774ba.

SS is a separate local branch based on that menu head. Original SS source has only GET /api/ss-projects; memo is read-only text, not an editing form. No business save API exists in this page and none was invented. Existing statuses, deadline date-only/JST semantics, remaining-day colors, completed toggle, sorting/persistence, original table-to-mobile-card structure and multiline memo text are retained. Official Button/Checkbox/Form-control/Alert/Card CSS is compiled into ss-bootstrap.css scoped solely to .ss-bootstrap. Source modules are selected separately; menu-bootstrap.css and icons.mjs remain byte-identical to the pushed menu commit. SS-only sorting/inbox SVGs live in ss-icons.mjs and reuse the common allowlist. Shared header/theme/native dialog behavior is not rewritten.

No Bootstrap JS, AutoAnimate, Motion, View Transition opt-in or drag library is needed on the read-only sorted SS table. Sort changes are explicit data sorting, not manual ordering. CSS reduced-motion/print transition suppression is local. Neither root menu nor any other feature page imports SS assets. The SS test fixture needed the correct text/javascript MIME for new .mjs assets; that test-only omission was fixed after the first run correctly failed to load the page.

Synthetic verification adds 320/390/768/1440px, touch-capable narrow contexts, dark settings, multiline memo, SVG auth fallback identity, reduced-motion, PDF generation, failing and delayed GET responses and unchanged input records. No real SS records, settings, files or external operations were used. The existing full menu browser suite is rerun for the shared build dependency. Physical print, actual iPhone, production authenticated browsing and real API latency remain unverified. Existing SS storage-quota handling and request-expiry behavior are unchanged rather than silently claimed as new safeguards.

Rollback SS independently: remove SS-only imports/classes and revert the tiny icon rendering changes in ss/app.js, then remove its scoped assets/build extension. Keep the underlying menu commit and its version1 layout contract. No DB or data rollback is necessary. Future public PR should clearly separate this SS commit from the already pushed menu head, and must wait for the pending permission.

SS batch final local results: 13 unit checks, the existing SS API test, all four SS viewport scenarios (320/390/768/1440, each dark/reduced-motion/print/error/delayed-read), and all 20 menu browser regression groups passed. Menu generated CSS/SVG diff against f89d0a5 is empty. No new remote operation or PR attempt occurred.

## Publication authorization and CI correction (2026-10-30)

After fresh explicit authorization, the known-unexecuted menu PR action was reconciled against GitHub (no existing PR) and retried once successfully as draft PR159. Its first unified-shell CI exposed an obsolete assertion requiring the root menu to load Boxicons. The paused integrated runtime was not changed: its test now verifies its own shell-app.mjs Boxicons import and the same class/license inventory, while root SVG use is covered by menu tests. All 115 integrated model/source tests passed locally. Menu assets remain the same; head64629527024b60fca0fc0eccd3b7a1e373d48c00 requires its own complete CI. SS local changes were rebased onto that test-only correction without conflict. The earlier denial is historical, not a continuing authority barrier after this new grant. View Transitions remain design-only, PR157 and integrated development remain paused.

Menu PR159 passed dashboard40978396853, unified-regression40978396877 and OAuth/legacy40978396895 at head64629527024b60fca0fc0eccd3b7a1e373d48c00, then merged as8048cb85362f1d451d36984fac2ae2a9408f7d47. Merge and tested trees match63f2722949f175e9e8115d165a5f4ef3f809f28e. SS was rebased onto this published main without conflict; its scope is the isolated SS adapter/tests and ledger, with no menu runtime changes. Pages deployment40979098364 is being observed separately from browser/live QA.

Menu deployment completed: Pages40979098364 at merge8048cb85362f1d451d36984fac2ae2a9408f7d47 succeeded; existing Cloudflare build bbba96ed-82a3-494b-820e-63f090ff95b5 succeeded with versionff8f88cf-f956-433f-8482-08a9e6aeacb1. Public URL https://works.lrnr.jp/ could not be directly read from this cloud environment (web tool inaccessible; browser previously tunnel failure). This is deployment evidence, not an authenticated live/iPhone verification. Rebased SS local 13-unit/4-width browser/20-menu-group checks passed again before its separate PR.

Final SS theme review found that official select caret styling keys on data-bs-theme, while Works owns data-theme. The SS adapter explicitly maps the existing resolved dark theme to the official dark SVG asset; it does not add a second controller. Synthetic tests now assert light/dark caret assets before capturing the dark view. This correction requires a new exact-head CI before merge.

## SS release and ToDo stage (2026-10-30)

PR160 ready transition was initially rejected (known unexecuted). Under a new explicit user grant for PR160 and future phased UI draft releases, draft/head/checks were reconciled; the one permitted retry succeeded. All checks at e43bb82777614f1f438d9484c3f625a93fd8605b passed: dashboard40980012843, integrated regression40980012875, OAuth/legacy40980012850, plus Workers build. Merge07ebe561f6eef1f5058dd16cff91c2a1b70989b8 tree matches tested1dbbf67398ecc02963387dc8c8ca5b081886bb9e. Pages40981129874 succeeded; Cloudflare build8c2eb88c-9849-46ed-a043-ac065ea3d30f / version767712ce-974d-4279-b44f-0c1d5adbb44c succeeded. No approval-review submission or production test saves.

Parent independently observed the public menu at1180px: two columns, new SVG/CSS, nine legacy links, no overflow or application console error. This is parent browser evidence, not this executor's live/authenticated/iPhone observation. SS live authentication/device/physical-print checks remain unverified.

ToDo is based on the now-merged SS main, with a separate scoped todo-bootstrap.css and todo-tokens.css. Official Button, Button group (the existing list/kanban toggle), Form-control, Checkbox, Card and persistent Alert are used. No Reboot, global CSS, JS Dialog/Tab controller, AutoAnimate, Motion, Sortable or View Transition is added: native dialogs already own history, focus, dirty checks and CAS recovery; lists replace innerHTML, so list animation would not safely represent stable item movement. Existing category earlier/later buttons and automatic task/date/status grouping are preserved. No new task drag capability is invented. Role emoji are stored user data and stay unchanged; four static navigation/action icons use the common Bootstrap SVG allowlist.

The ToDo business file changes only by importing/calling todo-presentation.mjs. This controller projects classes onto existing/static/dynamic controls, without changing values, names, disabled flags, handler attachment, datasets, order, dialog state, storage or API. A childList-only MutationObserver avoids reacting to its own class attributes and is disconnected on pagehide, idempotently restarted on pageshow. Icons cannot capture pointer targets. Source-based review specifically checked direct e.target.dataset handlers on checklist/category actions; their markup/targets are preserved. No input reparenting/replacement occurs, preserving focus, IME, validation, FormData and native date picker semantics.

Adapters preserve the original ToDo system font, 16px inputs, slate-blue palette and saturated primary actions, multiline memo/description/checklist fields, capture destination, category/role/filter controls and deadline/plan distinction. Initial rendered proof exposed a wrapping capture button and filter-label squeeze; explicit no-wrap/flex sizing fixes preserve the original one-line capture and labels. Dark select caret is connected to Works' existing resolved theme. No separate theme or data controller.

Local verification: 14 scoped/UI/model tests, 7 existing ToDo API/CAS tests using isolated fixtures, original personal-ToDo browser suite (320/390/1440 x light/dark), 24 category service/width/theme scenarios, presentation repeated-init/pagehide/pageshow no-write checks, dynamic reduced motion and print PDF. Existing tests cover stale detail revisions, category index races, cross-tab isolation, uncertain clone response without replay, frozen-midnight retry, repeated clicks, pending disabled controls, completion history/checklist reset, independent clones and delayed dialog dismissal. The menu browser suite and exact-head CI follow before release. Source menu/SS generated assets remain byte-identical. Actual iPhone/IME software-keyboard, authenticated live writes and physical printing are not tested; production test data is prohibited.

Page rollback: remove only ToDo adapter CSS/module references and its static icon placeholders/group class; keep common UI assets used by menu/SS. Reverting the whole shared/ui foundation after other pages depend on it is not a page rollback. No database migration or data rewrite is needed. KDP then Wiki remain next phases; all other unstarted pages remain in the ledger.
