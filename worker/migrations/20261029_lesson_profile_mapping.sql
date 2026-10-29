-- Additive only. No student, lesson or existing identity rows are modified.
CREATE TABLE IF NOT EXISTS lesson_profile_mapping (
 id TEXT PRIMARY KEY,
 calendar_id TEXT NOT NULL,
 event_id TEXT NOT NULL,
 source_json TEXT NOT NULL CHECK(json_valid(source_json)),
 source_title TEXT NOT NULL,
 source_generation INTEGER NOT NULL CHECK(source_generation>=0),
 target_name TEXT NOT NULL CHECK(length(target_name)>0 AND length(target_name)<=200),
 revision INTEGER NOT NULL CHECK(revision>0),
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 action TEXT NOT NULL CHECK(action IN ('bind','disable')),
 prior_id TEXT,
 request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
 actor TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 UNIQUE(calendar_id,event_id,revision),
 CHECK(COALESCE(json_type(source_json,'$.id')='text' AND json_type(source_json,'$.calendar_id')='text' AND json_extract(source_json,'$.id')=event_id AND json_extract(source_json,'$.calendar_id')=calendar_id,0)),
 CHECK((action='bind' AND active=1) OR (action='disable' AND active=0))
);
CREATE INDEX IF NOT EXISTS lesson_profile_mapping_source ON lesson_profile_mapping(calendar_id,event_id,revision DESC);
CREATE TRIGGER IF NOT EXISTS lesson_profile_mapping_no_update BEFORE UPDATE ON lesson_profile_mapping BEGIN SELECT RAISE(ABORT,'lesson profile mappings are append only'); END;
CREATE TRIGGER IF NOT EXISTS lesson_profile_mapping_no_delete BEFORE DELETE ON lesson_profile_mapping BEGIN SELECT RAISE(ABORT,'lesson profile mappings are append only'); END;
