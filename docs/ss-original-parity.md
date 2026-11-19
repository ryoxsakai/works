# SS original feature parity

Inventory: `ss/index.html`, `ss/app.js`, `ss/ss.css`. The original browser is read-only; it has no create/edit/complete/delete/execute controls and no custom print-settings form or data-export action.

Implemented:
- Original five-column project/status/JST deadline/remaining/memo table; mobile stacked rows retain every field and full multiline memo.
- All four column-heading sort buttons and aria-sort, select key, direction toggle and original select-resets-to-ascending behavior. Numeric/case-insensitive name comparison, fixed status rank, date/remaining comparisons and original name tie-break preserved, including invalid-date behavior.
- Existing `works_ss_sort` preferences; completed defaults off on fresh document. Same-document detail/back preserves integrated search/completed/sort state.
- Original active/total summary plus accurate visible count; completed/empty states, original deadline weekday labels, JST date rollover, five weekly urgency/overdue/completed colors.
- Existing integrated search, detail/deep links, detail print and original /ss/ retained. Production list renders the original table, not reduced cards. Demo-only editable sample remains isolated from production.
- Current filtered-list print with full memos, repeatable table headers and shell/control suppression; print palette remains readable under dark theme. No new server write API or business operation.
- Shared authenticated no-store GET, lifecycle cancellation, expiry/cross-tab cleanup, explicit retry and visibility-change refresh of client-side dates.

Verification:115 app units pass, including source-comparison fixtures for all sort keys/directions, numeric/case/ties/unknown states, invalid dates and remaining buckets. Browser CI gates include original table and keyboard sorting, shared preferences/detail Back/reload, non-JST browser timezone/JST rollover, multiline/XSS,320/390/768/1440 widths, dark mode, synthetic list PDF, retry/auth and no writes. Local Chromium is unavailable, so no local browser/actual-device/live/physical-print claim is made; terminal exact-head results belong in the PR/release evidence.

Remaining full checklist: lesson L13d explicit alias mapping and global whole-app certification items, plus supplied-image/real-device/authenticated production/physical output QA. See `lesson-alias-mapping-plan.md`; no aliases or real records are modified in this phase.
