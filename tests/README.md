# Student information UI regression check

Run from the Works repository root:

```sh
node --check tutor/app.js
node tests/student-selector.cjs
git diff --check
```

The browser check requires Playwright and Chromium (`/usr/bin/chromium` in the execution environment). All authentication, API, and calendar responses are fixtures; it never reads or writes production data. It verifies school/class grouping, horizontal overflow at 390px, real-name/calendar-tag labels, distinct compatibility ideographs (田﨑 / 田崎), existing memo and print-name loading, exact print-name save payload, term filtering, and local-only class overrides. Regression cases cover A6 Basic / M3 High class codes, school-switch detail clearing, school scoping for the same name, deduplication and matching of 田崎(振替) / 田崎（振替） / 田崎/英語, preserved restored legacy title keys, and failed goals/profile/material fetches blocking print-name saves. It captures mobile light/dark, desktop dark, and mobile settings screenshots in `/tmp/works-students-*.png`.

Selection labels use a unique exact match in `/students`; calendar_tag and compatibility ideographs are not replaced by the display label. Individual title annotations in parentheses or after a slash are stripped consistently for selection and matching. Class titles retain their full identity. Restored legacy title/search keys remain selectable with their original profile key, scoped to their saved school group when available. No database migrations, record renaming, or memo-history changes are included.

Current source limitations: the available directory is the calendar events loaded by existing schedule period settings (otherwise ±90 days). Japanese display names sort using the Japanese locale; accurate phonetic ordering requires a reading field. Daikanyama group classes with 集団 or グループ in the calendar/title, or an A/M + number class code such as A6 Basic or M3 High, are detected automatically; other class names can be classified in the settings modal. Overrides are stored on this device only. Existing profile APIs share a name key across calendars; this UI does not migrate or split those profiles. Curriculum schedule rows are scoped to the selected calendar group.

Async ownership regression checks hold actual Playwright network routes at Google Calendar, curriculum-record, goals, schools, profile, and materials responses. For each boundary, both a delayed success and delayed failure are released after a newer student's screen completes. Snapshots verify that rows, memo, print name, summary, errors, modal state and editing/busy flags remain owned by the latest operation. Additional cases cover old completion during a newer pending request, A → B → A switches, initial restoration superseded by navigation, and delayed profile saves preserving their original payload. No fixed sleeps are used; the fixtures release explicitly controlled responses. Race-state screenshots are written to `/tmp/works-students-race-*.png`.
