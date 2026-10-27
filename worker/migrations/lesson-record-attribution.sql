-- Additive only: no ownership backfill or existing lesson-record rewrite.

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_identity (
    event_id TEXT PRIMARY KEY, calendar_id TEXT, title TEXT, revision INTEGER NOT NULL DEFAULT 0);

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_archive (
    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, calendar_id TEXT, title TEXT,
    decision TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')));

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_guard (
    id TEXT PRIMARY KEY, ok INTEGER CHECK(ok = 1) NOT NULL);

-- statement
CREATE INDEX IF NOT EXISTS lesson_record_archive_event ON lesson_record_archive(event_id,created_at);

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_baseline (
    event_id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, title TEXT NOT NULL,
    event_start TEXT, event_etag TEXT, effective_date TEXT NOT NULL, observed_at TEXT DEFAULT (datetime('now')));

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_legacy_source (
    event_id TEXT PRIMARY KEY, snapshot_json TEXT NOT NULL, captured_at TEXT DEFAULT (datetime('now')));

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_hold (
    event_id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT);

-- statement
CREATE TABLE IF NOT EXISTS lesson_record_policy (
    id INTEGER PRIMARY KEY CHECK(id=1), effective_date TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    required_hold_count INTEGER NOT NULL DEFAULT 1 CHECK(required_hold_count>=1));

-- statement
CREATE TRIGGER IF NOT EXISTS lesson_record_revision_insert
    AFTER INSERT ON curriculum_entries BEGIN
    INSERT INTO lesson_record_identity(event_id, revision) VALUES (NEW.calendar_event_id, 1)
    ON CONFLICT(event_id) DO UPDATE SET revision = revision + 1; END;

-- statement
CREATE TRIGGER IF NOT EXISTS lesson_record_revision_update
    AFTER UPDATE ON curriculum_entries BEGIN
    INSERT INTO lesson_record_identity(event_id, revision) VALUES (NEW.calendar_event_id, 1)
    ON CONFLICT(event_id) DO UPDATE SET revision = revision + 1; END;

-- statement
CREATE TRIGGER IF NOT EXISTS lesson_record_revision_delete
    AFTER DELETE ON curriculum_entries BEGIN
    INSERT INTO lesson_record_identity(event_id, revision) VALUES (OLD.calendar_event_id, 1)
    ON CONFLICT(event_id) DO UPDATE SET revision = revision + 1; END;
