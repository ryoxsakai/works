# Student information UI regression check

Run from the Works repository root:

```sh
node --check tutor/app.js
node tests/student-selector.cjs
git diff --check
```

The browser check requires Playwright and Chromium (`/usr/bin/chromium` in the execution environment). All authentication, API, and calendar responses are fixtures; it never reads or writes production data. It verifies school/class grouping, horizontal overflow at 390px, real-name/calendar-tag labels, distinct compatibility ideographs (田﨑 / 田崎), existing memo and print-name loading, exact print-name save payload, term filtering, and local-only class overrides. It captures mobile light/dark, desktop dark, and mobile settings screenshots in `/tmp/works-students-*.png`.

Selection labels use a unique exact match in `/students`; the underlying calendar title remains the existing storage key. Restored legacy search tokens remain accessible under 保存中の選択. No database migrations, record renaming, or memo-history changes are included.

Current source limitations: the available directory is the calendar events loaded by existing schedule period settings (otherwise ±90 days). Japanese display names sort using the Japanese locale; accurate phonetic ordering requires a reading field. Daikanyama group classes with 集団 or グループ in the calendar/title are detected automatically; other class names can be classified in the settings modal. Overrides are stored on this device only. Existing profile APIs share a name key across calendars; this UI does not migrate or split those profiles. Curriculum schedule rows are scoped to the selected calendar group.
