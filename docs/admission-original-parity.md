# Works admissions original parity

Original source: `admission/index.html`, `admission/app.js`, `admission/admission.css`. This is Works admissions scheduling, not the separate Exam question service.

- Native list, calendar month/continuous, gantt and table use the original algorithms.
- University canonicalization/readings, type filters and earliest primary month by raw university key preserve original semantics. Stored scalar legacy filters upgrade as before.
- All/clear controls operate on the whole group even when university search hides choices, matching original behavior. Cancel/Escape leaves applied filters unchanged; focus returns to opener.
- Original dates, remaining days, notes, stage/type colors, grouping and printable university gantt retained.
- Old source has no year dropdown or create/edit/delete/export UI; do not invent them. The stale empty-state reference to a nonexistent add button is corrected.
- Existing integrated detail/editor and safe source link remain accessible from each list row. Guarded snapshots, busy navigation, conflicts and unknown outcome recovery remain unchanged.
- Shared auth/request lifecycle is used, no second login observer. Unmount aborts reads and removes print listeners; late responses cannot render into a new route.
- No schema/data migration or production test writes.

Verification pending: native browser/regression suite. Unit110/build passed. Local Chromium is absent; no successful screenshot/device/live claim is made.
