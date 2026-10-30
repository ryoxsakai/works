# Bootstrap 6 staged legacy UI rollout

Scope: old root menu and then old pages, not the paused integrated app. PR157 and its SQL are untouched. No database, API, auth, permission or production test data changes. Current branch starts from published main 7713fdb017370482415092ca097b424b031774ba. This first stage stops at draft PR; publication awaits a separate instruction.

## Resumable stage ledger

These are work batches, not an external automation or a promise of unattended scheduled execution. Finish and record a batch's tests before starting the next; public release requires the parent's instruction.

| Batch | Scope / completion condition | State |
| --- | --- | --- |
| 1 (first 2–3h) | Fixed source/dependencies, common tokens/SVG registry, menu component proof with actual rendered rules and no global CSS leakage | Implemented; synthetic checks pass |
| 2 (next 2–3h) | Whole menu uses selected official components, existing layout/edit/storage/auth/URLs maintained; mobile/desktop, dark, print, cancel/drag/reentry tested; draft PR | Implemented; final CI tracked in PR |
| 3 | SS representative page: original controls/status/table/print preserved | Not started; outside this first implementation batch |
| 4 | ToDo, then KDP and Wiki, one reversible page at a time | Not started |
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
