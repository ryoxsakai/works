# Legacy dashboard visual QA

final result: passed (requested composition and synthetic viewport/interaction QA; source-reference composition review supplied by parent)

The source reference is `IMG_7373.jpeg`, Library `libfile_8343a4613a548191b76a6a2b4028ba51`. The supported resolved-reference prepare/materialize flow returned a signed transfer; the current official helper failed with `library file transfer failed: download failed`. No local reference bytes were installed. Its actual pixels have **not** been inspected in this consuming environment. No fallback URL, raw download, image generation or unauthorized network change was used. The parent-observed composition description was used as a composition brief, not child-local pixel evidence. The parent subsequently actually viewed the original reference and the prior CI desktop/mobile screenshots, and confirmed the broad composition matches. No further transfer was attempted; child-local reference comparison remains unavailable.

The implementation's own synthetic rendered screenshots were captured in Chromium and visually inspected:

- `test-artifacts/dashboard/desktop-default-1440.png`: original Works brand, slim full-function left nav, pale background, white rounded two-column cards, date/action header.
- `mobile-default-390.png`: default canonical order in one column, collapsed all-function menu, legible input/action spacing, no horizontal overflow.
- `desktop-edit-1440.png`: explicit add/hide/reorder and save/cancel, separate drag handles.
- `mobile-reordered-390.png` and `mobile-dark-390.png`: saved reordering and theme adaptation.

Automated checks cover320/375/390/768/900/1440/1920px, keyboard focus/Escape/settings return, viewport changes, real mouse drag and emulated-touch drag, independent loading/error/empty rendering and read-only routes. Existing regression suite covers120 page/width/auth combinations with light/dark/print, shared theme and navigation guards. Real iPhone, live authenticated data, child-local reference-pixel comparison and physical print are not verified.

Parent review requested lessons-first initial ordering to keep teaching above the mobile fold. The new default is lessons → ToDo → shortcuts, with saved user ordering unchanged. Compact noncritical lists show3 items and explicit counts; every due-today or overdue ToDo/SS row remains visible, without internal card scrolling. The browser test asserts first-screen teaching content at390px and tests all6 widgets at320/390/768/1440px. Added all-widget desktop/edit/dark screenshots and mobile edit view.

Typography is the unchanged legacy M PLUS1p stack. The synthetic external-font block makes runner fallbacks visible; font-evidence.json records actual Chromium font use. Live font delivery and true iPhone rendering remain unverified.

No observed implementation-only P0/P1/P2 visual defect remains in the inspected synthetic states. The parent completed broad composition comparison; no pixel-identical replica is claimed. Keep the PR draft; no production publication in this stage.

## Header overlay investigation

The old all-widget full-page capture was taken after an add-widget action scrolled the document. The global header is `position:sticky; top:0`; Playwright can place that composited viewport layer at the retained scroll offset inside a full-document screenshot. Actual viewport captures at top/middle/bottom and after mobile resize/edit show headerTop0px at every position. This is a capture artifact, not a mid-page positioned header defect. All full-page QA captures now explicitly scroll to0 and wait two animation frames. `header-viewport-evidence.json`, `fullpage-capture-evidence.json` and `viewport-header-*.png` retain geometry and actual viewport evidence.

A separate real focus defect was reproduced: the focused skip-to-content link (z-index10) was behind the sticky header (z-index30). Only that dashboard link was raised to40. The test focuses every visible link/button/input and uses elementFromPoint to assert the focused control is not covered. No sticky positioning was changed.

Memo/material metadata now uses explicit JST display parsing: ISO instants require Z/an explicit offset; only material-files SQLite datetime('now') strings are interpreted as UTC. Memo calendar dates remain date-only; unknown/ambiguous values display '日時不明'. Date-only task/SS deadlines are not passed through this formatter or shifted.
