-- Additive registry. No existing runs, definitions, settings or schedules are changed.
CREATE TABLE IF NOT EXISTS wf_roles (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 archived INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS wf_role_insert AFTER INSERT ON wf_roles BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'role',new.id,new.revision,'active',new.data);
END;
CREATE TRIGGER IF NOT EXISTS wf_role_update AFTER UPDATE ON wf_roles BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'role',new.id,new.revision,CASE new.archived WHEN 1 THEN 'archived' ELSE 'active' END,new.data);
END;
-- Close the validation/write race between archival and new assignments.
CREATE TRIGGER IF NOT EXISTS wf_role_definition_insert BEFORE INSERT ON wf_definitions WHEN new.archived=0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(new.data,'$.tasks') t WHERE json_extract(t.value,'$.role_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf_roles r WHERE r.id=json_extract(t.value,'$.role_id') AND r.owner=new.owner AND r.archived=0)) THEN RAISE(ABORT,'role unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS wf_role_definition_update BEFORE UPDATE ON wf_definitions WHEN new.archived=0 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(new.data,'$.tasks') t WHERE json_extract(t.value,'$.role_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf_roles r WHERE r.id=json_extract(t.value,'$.role_id') AND r.owner=new.owner AND r.archived=0)) THEN RAISE(ABORT,'role unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS wf_role_run_insert BEFORE INSERT ON wf_runs BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(new.data,'$.tasks') t WHERE json_extract(t.value,'$.role_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf_roles r WHERE r.id=json_extract(t.value,'$.role_id') AND r.owner=new.owner AND r.archived=0)) THEN RAISE(ABORT,'role unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS wf_role_run_update BEFORE UPDATE ON wf_runs WHEN new.status NOT IN ('completed','cancelled') BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(new.data,'$.tasks') t WHERE json_extract(t.value,'$.status')!='completed' AND json_extract(t.value,'$.role_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf_roles r WHERE r.id=json_extract(t.value,'$.role_id') AND r.owner=new.owner AND r.archived=0)) THEN RAISE(ABORT,'role unavailable') END;
END;
