# KDP original UI parity

Source inventory: `kdp/index.html` (131 lines), `kdp/app.js` (794), `kdp/kdp.css` (277). Works manuscript management is independent of external KDP accounts and publishing. There are no submit/pricing/account controls or automatic AI adoption in the original.

Implemented native controls:
- Book list and show-archived; create/settings including title, subtitle, author, language, audience and description; reversible book archive.
- Chapter/section outline, title editing, creation, exact-sibling revision ordering and reversible archive.
- Explicit accepted Markdown manuscript title/body save, 300-character title, long/multiline Unicode text, 5MB PNG/JPEG insertion into the unsaved manuscript using existing private storage.
- Source URL/name/checked date/target year/notes, editing and reversible archive.
- Separate proposals with exact base revision, escaped diff, explicit adopt/reject, never inferred from source text. Proposal response/body and target identities checked.
- Paginated immutable section history, explicit confirm-to-restore into a new revision.
- EPUB, JSON backup and Markdown ZIP downloads through existing authenticated APIs, with object URL cleanup.

Only the original /kdp/ route and internal book/section selectors are ported; the original did not have per-section browser URLs. Unified /app/#!/kdp/ is a distinct app route and reload returns to the book list, matching the original. Original /kdp/ remains available.

Safety: shared session once; narrow KDP transport/methods; no new permission, schema or dependency. One operation at a time, controls freeze, modal drafts protected, native Back closes modal first. CAS conflicts and uncertain results stop writes, preserve input/operation receipts and provide read-only inspection/export/reset without replay. Acknowledged save followed by failed refresh is held too. Same-named created books never imply attribution or successful reconciliation. Existing backend ownership/revision/ancestor/atomic reorder gates remain authoritative. No live records are edited for tests.

Verification:112 app unit tests and15 actual isolated KDP Worker tests pass locally; local Chromium is absent. Full native synthetic D1/R2 browser tests and all existing suites are mandatory exact-head CI gates before release. Actual device/live authenticated production/physical output and supplied screenshot pixels remain unverified.

Remaining full migration: SS original-feature audit and explicit safe lesson-alias mapping. KDP does not add third-party publishing or communications.

Image API safety finding fixed: a lost put/INSERT response now returns typed502 with exact operation reference and retains potentially committed bytes. Synthetic fault tests prove no compensating delete after a committed INSERT. Uncertain unreferenced objects are retained for later explicit reconciliation; no cleanup job or deletion was added.
