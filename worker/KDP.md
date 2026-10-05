# KDP管理

Open Works → 制作 → **KDP管理** (`https://works.lrnr.jp/kdp/`) using the existing owner Google session. New login reuses the established `/tutor/` Google callback and then returns to KDP管理; no additional Google redirect registration is needed.
Create a book, fill its title/author/language/audience/description, add chapters and sections,
and select one section to write. Markdown supports headings, unordered/numbered lists,
bold, inline code, HTTP(S) links and uploaded images. Raw HTML remains literal text.
Save status shows the revision. Save before switching sections; an unsaved draft prompts before
navigation. Writes or image uploads block navigation while pending. A conflict preserves the
local draft: copy it, reload, compare and save against the latest revision.

Sources store URL, confirmation date, target year and notes for each section. A proposal contains
its own text, change notes and exact base revision. Compare the adopted text and proposal before
accepting. Acceptance fails if the section has changed. Rejecting does not change adopted text.
History → 復元 creates a new revision. All books, chapters, sections, sources and proposals have
immutable database history; section history is available in the UI in pages of 10 snapshots; 「以前の履歴を読み込む」 retrieves older revisions. Archive is reversible. Turn on
「アーカイブも表示」 to restore. Restore an archived parent before editing its children.
The up/down controls atomically reorder every active sibling using every sibling's current revision.

## ChatGPT

The existing authenticated `/mcp` connection exposes:

- `list_kdp_books`
- `get_kdp_book` with `book_id`
- `get_kdp_section` with `section_id` (adopted body/revision, sources, latest 20 proposals and history metadata)
- `create_kdp_proposal` with `section_id`, exact `base_revision`, `body`, optional `title`/`notes`

Create the book's structure in the browser, then ask ChatGPT to read the exact section and save its
rewrite as a proposal. Return to the browser to compare and adopt. MCP has no adopted-text,
acceptance, restoration, archive, image upload or structure-write tool. Its audience/scope-bound
token is explicitly refused by the KDP browser API. No paid AI API runs automatically.
The existing grant, key, fixed expiry and refresh/revocation implementation is unchanged.
The consent page describes KDP read/proposal capabilities. Anonymous discovery only describes
schemas; execution needs the existing short-lived authenticated MCP token.

## Portable downloads

- EPUB: EPUB 3, complete chapter/section TOC, UTF-8 mixed Japanese/English, escaped XHTML,
  private R2 images embedded in the ZIP; only active chapters and sections are included.
  Current manuscript export is independent of accumulated history size.
- JSON: versioned backup with book metadata, every chapter/section (including archived), sources,
  proposals, immutable history and base64 PNG/JPEG assets streamed image by image.
- Markdown: ZIP with `manuscript.md`, `backup.json`, and `images/` assets. The JSON references
  asset files inside the ZIP instead of duplicating images as base64.

Download with the authenticated browser; export URLs are private. JSON/Markdown are portable
backups, not a one-click import UI. EPUB is a manuscript export, not KDP publication or upload.
EPUB covers, footnotes, complex tables and arbitrary HTML are outside this first version.

Images are PNG/JPEG, at most 5 MiB per upload and 20 MiB / 40 images per book. Assets stay
private in existing `MATERIALS_BUCKET` under `kdp/{book_id}/{asset_id}`; no external image fetching.
A section body is limited to 200,000 characters, a JSON write to 512 KiB, and a parent to 1,000
items. Export has an 8 MiB text/backup safety budget (images have their separate budget).
A conservative UTF-8/JSON/history-size preflight can stop a backup before that exact output size;
large books with many revisions may need a future streaming history backup. EPUB ignores history.
An error never deletes data. Browser drafts are held in memory until saved; beforeunload prompts
cannot guarantee recovery after an OS/browser force-close. Mobile viewport testing does not certify
every OS keyboard.

## Storage and release

`DB` holds additive `kdp_*` tables and immutable SQLite snapshot triggers. Migrations:
`migrations/001-kdp.sql` and `002-kdp-assets.sql`. The same CREATE IF NOT EXISTS statements run
lazily only after an authenticated KDP request; no manual production migration is required.
Existing business tables and assets are not changed. No new binding, credential or persistent
access is required. Upload quota checks also run atomically in a DB trigger. Failed metadata
insertion removes only that upload's newly created R2 object. Assets are retained with revisions.

Deploy through the existing main-branch GitHub Pages/Cloudflare build after draft PR review and
CI validation. Rolling back the code leaves the additive KDP data intact.

## Verification

`npm test` exercises existing OAuth grant/refresh/browser-session, curriculum, materials, ToDo,
SS and admission behavior, plus KDP SQL and real Miniflare D1/R2 authenticated API/MCP tests.
`npm run test:browser` uses synthetic HTTPS for OAuth browser regression.
`npm run test:kdp:browser` uses synthetic HTTPS, isolated D1/R2 and desktop/mobile Chromium for
book/section/source/proposal/history/archive/export/menu flows, including delayed save/upload, duplicate dialog submission protection, title limits and history pagination.
No real user data is used. On macOS, the fixture uses installed Chrome; Linux CI uses Playwright.
