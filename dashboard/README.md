# Legacy menu dashboard

This changes only the old `/` menu. All nine existing feature URLs open their original pages. There is no integrated-app routing, iframe, API, schema or permission change. Draft PR157 and its optional alias migration are unrelated and not prerequisites.

## Presentation and data

- Desktop: a narrow, permanent all-function navigation and two-column CSS grid. Below900px: collapsible navigation and the same widget order in one column. The original Works wordmark, shared typography/theme/settings, Boxicons and authentication are retained.
- Defaults: today's lessons, today's/carryover ToDo, configurable shortcuts. Existing saved ordering is preserved without migration. Optional: updated memo **titles only**, recently **added** material filenames, active SS deadlines. Preview/download bodies are never requested automatically. Each card links only to the existing module root.
- ToDo matches legacy status fallback, plannedDay and7-day/overdue deadline logic separately. JST dates are used, including foreground midnight rollover. Calendar uses the existing OAuth token helper, exact configured title exclusions, per-calendar pagination and at most3 concurrent calendar readers. Same-name/cross-calendar events are not combined. No lesson-record, lesson-plan, baseline, student or machine-key schedule API is called.
- Existing ToDo/memo/material/SS APIs return full collections; showing a compact summary does not limit network payloads. Optional widgets fetch only when enabled. No rapid polling: manual refresh and expired in-memory data on return to a visible tab. Requests coalesce while pending; each widget independently times out after20s and offers retry. Calendar failure aborts sibling requests. Token acquisition itself cannot be cancelled in the shared helper, so a timed-out reader is detached and its late token cannot initiate Calendar traffic.
- Logout, other-tab auth changes, pagehide, account/date changes and widget removal abort/fence results. Data is held only in memory and cleared on logout/pagehide. Auth expiry resets the header as well as widgets.

Compact lists show3 noncritical items with explicit total/displayed/remaining counts and a link to the unchanged original page. Every due-today or overdue ToDo/SS deadline remains visible, even if this makes its card longer. Cards have no internal scrolling.

## Layout editing

Explicit edit, add/hide, drag handle, keyboard-operable earlier/later buttons, shortcut checkboxes, save/cancel and confirmed initial-layout reset. Hide changes presentation only; there are no business-data save/complete/delete controls. Leaving a dirty edit asks first; interruption has beforeunload protection. On bfcache-style return, the in-memory draft is retained; unsaved changes are not persisted across a full reload.

The version1 allowlisted layout uses `works-home-dashboard-v1:<SHA256 authenticated email>` in device-local storage. It contains only widget IDs/order and allowlisted shortcut routes. No contents, email, credential or token is written to the layout. There is no cross-device sync. Unknown/duplicate IDs, foreign routes, future versions and oversized/malformed data fall back visibly. Quota/security errors leave the draft intact and never claim a save succeeded. Other-tab preference changes prompt reload rather than overwriting a draft.

## Dependencies

- SortableJS1.15.6, official npm package, MIT, vendored unchanged and loaded only in edit mode. SHA256 `6d0a831fc19b4bae851797ad3393157e861afb7862459c11226359b27e2c4337`. Package integrity `sha512-aNfiuwMEpfBM/CN6LY0ibyhxPfPbyFeBTYJKCvzkJ2GkUpazIt3H+QIPAMHwqQ7tMKaHz1Qj+rJJCqljnf4p3A==`. Upstream https://github.com/SortableJS/Sortable . If loading fails, earlier/later buttons remain available.
- Existing Boxicons2.1.4, MIT, official npm package copied locally. Its CSS font-face references only the included unchanged WOFF2; remaining icon definitions are unchanged. The legacy external font stylesheet remains as before. No React, framework or paid dependency.

## Verification

`node --test dashboard/test/*.test.mjs`

`BROWSER_EXECUTABLE=/usr/bin/chromium node dashboard/test/browser.mjs`

The browser suite intercepts **all** requests at synthetic origins and never uses production credentials/data. It captures desktop, mobile, edit, reordered and dark states under `test-artifacts/dashboard`. CI installs the existing worker dev dependencies and uploads that directory as an artifact. Existing header/theme, KDP and workflow tests adapt only their root-menu fixture/selectors; original feature-page assertions remain.

Reference-image download currently failed in this consuming environment. Rendered screenshots were inspected, but no claim of reference-pixel comparison or real iPhone/live-authenticated QA is made. See `design-qa.md`. This is draft-review-only; no merge/deployment is authorized in this stage.

## Typography evidence

No typography redesign: legacy shared/styles.css declares body `"M PLUS 1p", system-ui, -apple-system, "Segoe UI", sans-serif` (final override near line1888),400 normal weight. The legacy shared header declares `"M PLUS 1p", system-ui, sans-serif`. Root index.html retains the original Google Fonts400/500/700 stylesheet. The synthetic harness intentionally blocks external requests, including that font; CI therefore renders its installed fallback, which can look serif-like for Japanese. `font-evidence.json` captures the exact computed stack and Chromium-reported platform font for the current runner; local Chromium used Noto Sans CJK JP. This is not evidence that the production font is serif. Live webfont delivery remains unverified.

## Sticky-header capture and metadata display

Viewport QA covers top/middle/bottom and resize/edit positions. The earlier all-widget full-page header strip was a screenshot taken at a nonzero document scroll position; all full-page captures now reset scroll before capture. Viewport header geometry and hit-tested focused controls are recorded as artifacts. The dashboard skip link's stacking order was corrected above the existing sticky header; feature-page header positioning is unchanged.

Memo/material metadata formats known instants as `YYYY/MM/DD HH:mm JST`. Explicit-offset ISO strings are instants. Material-file created_at strings without an offset are the schema's SQLite datetime('now') UTC values, parsed explicitly as UTC. Date-only memo metadata keeps its calendar date with a '日付のみ' label. Other ambiguous values are '日時不明'. Task and SS date-only deadlines retain their existing date strings and semantics. No stored values change.
