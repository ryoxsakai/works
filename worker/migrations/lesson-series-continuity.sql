-- Additive: explicit future-series ownership, separate fixed-owner shared memos.
CREATE TABLE IF NOT EXISTS lesson_series_owners (
 id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL,series_id TEXT NOT NULL,
 anchor_original TEXT NOT NULL,parent_identity_json TEXT NOT NULL,expected_title TEXT NOT NULL,
 owner_id TEXT NOT NULL REFERENCES lesson_owners(id),revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,
 UNIQUE(calendar_id,series_id,anchor_original)
);
CREATE TABLE IF NOT EXISTS lesson_owner_memos (
 owner_id TEXT PRIMARY KEY REFERENCES lesson_owners(id),memo TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL
);
