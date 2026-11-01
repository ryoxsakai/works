-- Additive only. No legacy table, Calendar description or student memo is changed.
CREATE TABLE IF NOT EXISTS lesson_owners (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('student','class')),
 name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_owner_aliases (
 owner_id TEXT NOT NULL REFERENCES lesson_owners(id), name TEXT NOT NULL,
 PRIMARY KEY(owner_id,name)
);
CREATE TABLE IF NOT EXISTS lesson_history_records (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES lesson_owners(id),
 lesson_date TEXT NOT NULL, title_snapshot TEXT NOT NULL,
 lesson_plan TEXT NOT NULL, confirmation_test TEXT NOT NULL, homework TEXT NOT NULL, lesson_memo TEXT NOT NULL,
 completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 1, source_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lesson_history_owner_date ON lesson_history_records(owner_id,lesson_date,id);
CREATE TABLE IF NOT EXISTS lesson_event_links (
 calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, record_id TEXT UNIQUE REFERENCES lesson_history_records(id),
 revision INTEGER NOT NULL DEFAULT 1, target_json TEXT NOT NULL, event_identity_json TEXT NOT NULL,
 PRIMARY KEY(calendar_id,event_id)
);
CREATE TABLE IF NOT EXISTS lesson_history_audit (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_history_requests (
 id TEXT PRIMARY KEY, digest TEXT NOT NULL, response_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lesson_history_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE IF NOT EXISTS lesson_history_imports (
 calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, record_id TEXT NOT NULL UNIQUE REFERENCES lesson_history_records(id),
 fingerprint TEXT NOT NULL, source_json TEXT NOT NULL, PRIMARY KEY(calendar_id,event_id)
);
CREATE TABLE IF NOT EXISTS lesson_history_exclusions (
 calendar_id TEXT NOT NULL,event_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(calendar_id,event_id)
);
-- Seed these only in a separately reviewed rollout, after exclusions and import parity checks.
CREATE TABLE IF NOT EXISTS lesson_history_policy (
 id INTEGER PRIMARY KEY CHECK(id=1), exclusions_reviewed INTEGER NOT NULL DEFAULT 0,
 cutover_ready INTEGER NOT NULL DEFAULT 0, evidence_json TEXT NOT NULL
);
-- Unattributed plans only. No owner or legacy record is created or reassigned.
-- Context includes the exact observed ETag/ref and creation identity. Old contexts remain recoverable.
CREATE TABLE IF NOT EXISTS lesson_pending_plans (
 id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL,
 target_json TEXT NOT NULL, event_identity_json TEXT NOT NULL,
 lesson_plan TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lesson_pending_event ON lesson_pending_plans(calendar_id,event_id,updated_at);
