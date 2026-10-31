-- Additive prerequisite only. Do not execute before a verified private backup.
-- Source curriculum_entries and existing attribution tables are never deleted.
CREATE TABLE IF NOT EXISTS calendar_lesson_migration (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL,
 calendar_id TEXT NOT NULL,
 record_revision INTEGER NOT NULL,
 record_generation INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','dispatching','unknown','precondition_failed','verified')),
 verification_json TEXT,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_lesson_migration_active
 ON calendar_lesson_migration(event_id)
 WHERE status IN ('reserved','dispatching','unknown');
CREATE INDEX IF NOT EXISTS calendar_lesson_migration_event
 ON calendar_lesson_migration(event_id,calendar_id);
