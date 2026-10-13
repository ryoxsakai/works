CREATE TRIGGER wiki_folder_insert_depth BEFORE INSERT ON wiki_folders WHEN new.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS (
 SELECT id,parent_id,1 FROM wiki_folders WHERE id=new.parent_id UNION ALL
 SELECT f.id,f.parent_id,a.depth+1 FROM wiki_folders f JOIN ancestors a ON f.id=a.parent_id
 ) SELECT coalesce(max(depth),0) FROM ancestors)>15 THEN RAISE(ABORT,'folder depth limit') END;
END;
CREATE TRIGGER wiki_folder_move_guard BEFORE UPDATE OF parent_id ON wiki_folders WHEN new.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS (
 SELECT id,parent_id FROM wiki_folders WHERE id=new.parent_id UNION ALL
 SELECT f.id,f.parent_id FROM wiki_folders f JOIN ancestors a ON f.id=a.parent_id
 ) SELECT 1 FROM ancestors WHERE id=new.id) THEN RAISE(ABORT,'folder cycle') END;
 SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS (
 SELECT id,parent_id,1 FROM wiki_folders WHERE id=new.parent_id UNION ALL
 SELECT f.id,f.parent_id,a.depth+1 FROM wiki_folders f JOIN ancestors a ON f.id=a.parent_id
 ) SELECT coalesce(max(depth),0) FROM ancestors)+(WITH RECURSIVE descendants(id,depth) AS (
 SELECT old.id,1 UNION ALL SELECT f.id,d.depth+1 FROM wiki_folders f JOIN descendants d ON f.parent_id=d.id
 ) SELECT max(depth) FROM descendants)>16 THEN RAISE(ABORT,'folder depth limit') END;
END;
DROP TRIGGER wiki_history_insert;
DROP TRIGGER wiki_history_update;
CREATE TRIGGER wiki_history_insert AFTER INSERT ON wiki_pages BEGIN
 INSERT INTO wiki_history(page_id,revision,snapshot) VALUES(new.id,new.revision,json_object('id',new.id,'revision',new.revision,'title',new.title,'body',new.body,'sources',json(new.sources),'tags',json(new.tags),'aliases',json(new.aliases),'links',json(new.links),'status',new.status,'archived',new.archived,'updated_at',new.updated_at,'folder_id',new.folder_id));
END;
CREATE TRIGGER wiki_history_update AFTER UPDATE ON wiki_pages BEGIN
 INSERT INTO wiki_history(page_id,revision,snapshot) VALUES(new.id,new.revision,json_object('id',new.id,'revision',new.revision,'title',new.title,'body',new.body,'sources',json(new.sources),'tags',json(new.tags),'aliases',json(new.aliases),'links',json(new.links),'status',new.status,'archived',new.archived,'updated_at',new.updated_at,'folder_id',new.folder_id));
END;
