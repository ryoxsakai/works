-- Unattributed plans only. No owner or legacy record is created or reassigned.
-- Context includes the exact observed ETag/ref and creation identity. Old contexts remain recoverable.
CREATE TABLE IF NOT EXISTS lesson_pending_plans (
 id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL,
 target_json TEXT NOT NULL, event_identity_json TEXT NOT NULL,
 lesson_plan TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lesson_pending_event ON lesson_pending_plans(calendar_id,event_id,updated_at);
