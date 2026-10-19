-- Additive, separate from ToDo and Wiki. Apply explicitly to DB; no automatic migration.
CREATE TABLE IF NOT EXISTS wf_definitions (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 data TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, next_due TEXT,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS wf_versions (
 definition_id TEXT NOT NULL, revision INTEGER NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(definition_id, revision)
);
CREATE TABLE IF NOT EXISTS wf_runs (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, definition_id TEXT NOT NULL,
 definition_revision INTEGER NOT NULL, scheduled_for TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'queued',
 generation INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER,
 data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(definition_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS wf_runs_owner_status ON wf_runs(owner,status,scheduled_for);
-- Tasks have stable IDs and are transactionally projected from each fenced Run update.
CREATE TABLE IF NOT EXISTS wf_tasks (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, run_id TEXT NOT NULL, position INTEGER NOT NULL,
 revision INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL,
 UNIQUE(run_id,position)
);
CREATE TABLE IF NOT EXISTS wf_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, entity TEXT NOT NULL,
 entity_id TEXT NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, snapshot TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(entity,entity_id,revision)
);
CREATE TABLE IF NOT EXISTS wf_settings (
 owner TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1, desired_interval INTEGER NOT NULL DEFAULT 60,
 actual_interval INTEGER, automation_ref TEXT, last_patrol TEXT, stopped INTEGER NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS wf_definition_insert AFTER INSERT ON wf_definitions BEGIN
 INSERT INTO wf_versions VALUES(new.id,new.revision,new.owner,new.data);
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'definition',new.id,new.revision,'draft',new.data);
END;
CREATE TRIGGER IF NOT EXISTS wf_definition_update AFTER UPDATE ON wf_definitions BEGIN
 INSERT INTO wf_versions VALUES(new.id,new.revision,new.owner,new.data);
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'definition',new.id,new.revision,CASE new.enabled WHEN 1 THEN 'enabled' ELSE 'stopped' END,new.data);
END;
CREATE TRIGGER IF NOT EXISTS wf_run_insert AFTER INSERT ON wf_runs BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'run',new.id,new.revision,new.status,new.data);
 INSERT OR REPLACE INTO wf_tasks SELECT new.id||':'||j.key,new.owner,new.id,j.key,new.revision,json_extract(j.value,'$.status'),j.value FROM json_each(new.data,'$.tasks') AS j;
END;
CREATE TRIGGER IF NOT EXISTS wf_run_update AFTER UPDATE ON wf_runs BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'run',new.id,new.revision,new.status,new.data);
 INSERT OR REPLACE INTO wf_tasks SELECT new.id||':'||j.key,new.owner,new.id,j.key,new.revision,json_extract(j.value,'$.status'),j.value FROM json_each(new.data,'$.tasks') AS j;
END;
CREATE TRIGGER IF NOT EXISTS wf_versions_immutable_update BEFORE UPDATE ON wf_versions BEGIN SELECT RAISE(ABORT,'immutable workflow version'); END;
CREATE TRIGGER IF NOT EXISTS wf_versions_immutable_delete BEFORE DELETE ON wf_versions BEGIN SELECT RAISE(ABORT,'immutable workflow version'); END;
CREATE TRIGGER IF NOT EXISTS wf_history_immutable_update BEFORE UPDATE ON wf_history BEGIN SELECT RAISE(ABORT,'immutable workflow history'); END;
CREATE TRIGGER IF NOT EXISTS wf_history_immutable_delete BEFORE DELETE ON wf_history BEGIN SELECT RAISE(ABORT,'immutable workflow history'); END;
CREATE TRIGGER IF NOT EXISTS wf_settings_insert AFTER INSERT ON wf_settings BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'settings',new.owner,new.revision,'settings',json_object('desired_interval',new.desired_interval,'actual_interval',new.actual_interval,'automation_ref',new.automation_ref,'last_patrol',new.last_patrol,'stopped',new.stopped));
END;
CREATE TRIGGER IF NOT EXISTS wf_settings_update AFTER UPDATE ON wf_settings BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'settings',new.owner,new.revision,'settings',json_object('desired_interval',new.desired_interval,'actual_interval',new.actual_interval,'automation_ref',new.automation_ref,'last_patrol',new.last_patrol,'stopped',new.stopped));
END;
