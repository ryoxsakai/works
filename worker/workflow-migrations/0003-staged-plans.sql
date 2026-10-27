-- Future planning is data only: this table never creates Runs or modifies scheduling.
CREATE TABLE IF NOT EXISTS wf_staged_plans (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL, definition_id TEXT NOT NULL,
 definition_revision INTEGER NOT NULL, scheduled_for TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1, definition_data TEXT NOT NULL, data TEXT NOT NULL,
 UNIQUE(owner,definition_id,scheduled_for)
);
CREATE TRIGGER IF NOT EXISTS wf_staged_insert AFTER INSERT ON wf_staged_plans BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'staged_plan',new.id,new.revision,'planned',json_object('definition_id',new.definition_id,'definition_revision',new.definition_revision,'scheduled_for',new.scheduled_for,'data',json(new.data)));
END;
CREATE TRIGGER IF NOT EXISTS wf_staged_update AFTER UPDATE ON wf_staged_plans BEGIN
 INSERT INTO wf_history(owner,entity,entity_id,revision,status,snapshot) VALUES(new.owner,'staged_plan',new.id,new.revision,'planned',json_object('definition_id',new.definition_id,'definition_revision',new.definition_revision,'scheduled_for',new.scheduled_for,'data',json(new.data)));
END;
CREATE TRIGGER IF NOT EXISTS wf_staged_role_insert BEFORE INSERT ON wf_staged_plans BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(new.data,'$.plans') p WHERE json_extract(p.value,'$.role_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf_roles r WHERE r.id=json_extract(p.value,'$.role_id') AND r.owner=new.owner AND r.archived=0)) THEN RAISE(ABORT,'staged role unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS wf_staged_role_update BEFORE UPDATE ON wf_staged_plans BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(new.data,'$.plans') p WHERE json_extract(p.value,'$.role_id') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM wf_roles r WHERE r.id=json_extract(p.value,'$.role_id') AND r.owner=new.owner AND r.archived=0)) THEN RAISE(ABORT,'staged role unavailable') END;
END;
CREATE TRIGGER IF NOT EXISTS wf_role_staged_archive BEFORE UPDATE ON wf_roles WHEN new.archived=1 BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM wf_staged_plans p JOIN wf_definitions d ON d.id=p.definition_id AND d.owner=p.owner,json_each(p.data,'$.plans') t WHERE p.owner=new.owner AND d.enabled=1 AND d.archived=0 AND d.data=p.definition_data AND NOT EXISTS(SELECT 1 FROM wf_runs r WHERE r.owner=p.owner AND r.definition_id=p.definition_id AND r.scheduled_for=p.scheduled_for) AND json_extract(t.value,'$.role_id')=new.id) THEN RAISE(ABORT,'staged plans reference role') END;
END;
