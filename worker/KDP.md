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

MCP proposals remain drafts until adopted. Existing `schedule:read` connections keep these four
capabilities; refreshing or reconnecting with that scope never grants manuscript editing.

A separately approved release can enable five additional tools:

- `create_kdp_book`: `request_id`, `title`; optional subtitle/author/language/audience/description
- `create_kdp_chapter`: `request_id`, `book_id`, exact `book_revision`, `title`; optional `sort_order`
- `create_kdp_section`: `request_id`, `chapter_id`, exact `chapter_revision`, `title`; optional
  `body` (saved as initial adopted text) and `sort_order`
- `accept_kdp_proposal`: `request_id`, `proposal_id`, exact proposal `revision` and `base_revision`
- `reject_kdp_proposal`: `request_id`, `proposal_id`, exact proposal `revision`

Read `get_kdp_book` before creating children and `get_kdp_section` before deciding proposals.
Compare the current body with the requested proposal. Acceptance changes only the section body
and proposal status, atomically, when the proposal is pending and its original section revision
still matches. Rejection preserves the body and, as in the browser, remains available while archived.
Creation and acceptance require active ancestors; their archive/revision guards run inside the write.
No MCP direct-update, restoration, archive, upload, publication or deletion tool is added.
The MCP token remains refused by the browser KDP API. No paid AI API runs automatically.

Each new edit requires a unique `request_id` (8–128 letters, digits, underscores or hyphens).
Reuse the same ID and **all the same arguments** after a lost response. A grant-bound immutable
receipt commits in the same D1 transaction as the write, referring to immutable history snapshots.
An identical retry returns the original committed result even after later browser edits; read again
for current state. A reused ID with changed arguments/operation fails. A failed CAS stores no receipt.
Receipts are small metadata, retained separately from portable manuscript backups, and remain
scoped to that authorization grant (including after access-token refresh).

### Editing authorization and release gate

Without `KDP_MCP_WRITE_ENABLED="true"`, new tools and the `kdp:write` discovery scope are hidden,
and direct calls are denied. The owner approved the editing release on 2026-10-06; the existing
Worker configuration now sets this flag. Existing grants, credentials, OAuth registrations,
bindings and browser login settings remain unchanged. This exposes the editing tools and permits requests for
`scope=schedule:read kdp:write`. The client must request both scopes and complete a new OAuth
connection; a plain `schedule:read` request stays at its existing permissions. Scope order is
normalized. Verify that the connector requests the new scope when it reconnects.

The authorization form describes structure creation, initial text and proposal adoption/rejection,
and requires a separate **unchecked** editing checkbox. Remembered browser login does not skip
this consent. The resulting new code/family carries exactly the consented scopes. Existing
families cannot be upgraded by refresh. Access requires a valid, unrevoked family with matching
scopes; legacy access tokens without a family cannot edit. The one-hour access-token expiry and
fixed 30-day refresh deadline remain unchanged. No credential generation/rotation is needed.
Disabling the flag immediately denies editing even for an already-consented grant; reading,
proposal creation and normal refresh remain available. Future changes to access still require
owner approval; no production manuscript writes should be used for verification.

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
`migrations/001-kdp.sql`, `002-kdp-assets.sql` and `003-kdp-mcp.sql` (edit receipts). The same CREATE IF NOT EXISTS statements run
lazily only after an authenticated KDP request; no manual production migration is required.
Existing business tables and assets are not changed. No new binding or credential is required. The optional MCP edit permission requires the
explicit consent and release approval described above. Upload quota checks also run atomically in a DB trigger. Failed metadata
insertion removes only that upload's newly created R2 object. Assets are retained with revisions.

Deploy through the existing main-branch GitHub Pages/Cloudflare build after draft PR review and
CI validation. Rolling back the code leaves the additive KDP data intact.

## Verification

`npm test` exercises existing OAuth grant/refresh/browser-session, curriculum, materials, ToDo,
SS and admission behavior, plus KDP SQL and real Miniflare D1/R2 authenticated API/MCP tests.
`npm run test:browser` uses synthetic HTTPS for OAuth browser regression.
`npm run test:kdp:browser` uses synthetic HTTPS, isolated D1/R2 and desktop/mobile Chromium for
book/section/source/proposal/history/archive/export/menu flows, including delayed save/upload, duplicate dialog submission protection, title limits and history pagination.
OAuth Chromium coverage also checks that remembered login cannot preselect/skip KDP editing consent.
`test/kdp-mcp-write.test.mjs` checks disabled/old/legacy/revoked/expired grants, exact consent,
CSRF scope binding, refresh non-expansion, structure/decision retries, concurrent acceptance/rejection,
CAS/ancestor archives, transactional rollback and immutable receipts/history.
No real user data is used. On macOS, the fixture uses installed Chrome; Linux CI uses Playwright.
