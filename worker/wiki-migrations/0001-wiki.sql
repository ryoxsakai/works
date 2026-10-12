CREATE TABLE wiki_pages (
 id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 title TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL, tags TEXT NOT NULL,
 aliases TEXT NOT NULL, links TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','confirmed')),
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX wiki_pages_recent ON wiki_pages(archived,updated_at DESC,id);
CREATE TABLE wiki_history (
 page_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(page_id,revision)
);
CREATE TABLE wiki_proposals (
 id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES wiki_pages(id), base_revision INTEGER NOT NULL,
 content TEXT NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX wiki_proposals_page ON wiki_proposals(page_id,created_at);
CREATE TRIGGER wiki_history_insert AFTER INSERT ON wiki_pages BEGIN
 INSERT INTO wiki_history(page_id,revision,snapshot) VALUES(new.id,new.revision,json_object('id',new.id,'revision',new.revision,'title',new.title,'body',new.body,'sources',json(new.sources),'tags',json(new.tags),'aliases',json(new.aliases),'links',json(new.links),'status',new.status,'archived',new.archived,'updated_at',new.updated_at));
END;
CREATE TRIGGER wiki_revision_guard BEFORE UPDATE ON wiki_pages WHEN new.revision != old.revision+1 OR new.id != old.id BEGIN SELECT RAISE(ABORT,'revision must advance'); END;
CREATE TRIGGER wiki_history_update AFTER UPDATE ON wiki_pages BEGIN
 INSERT INTO wiki_history(page_id,revision,snapshot) VALUES(new.id,new.revision,json_object('id',new.id,'revision',new.revision,'title',new.title,'body',new.body,'sources',json(new.sources),'tags',json(new.tags),'aliases',json(new.aliases),'links',json(new.links),'status',new.status,'archived',new.archived,'updated_at',new.updated_at));
END;
CREATE TRIGGER wiki_history_immutable_update BEFORE UPDATE ON wiki_history BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER wiki_history_immutable_delete BEFORE DELETE ON wiki_history BEGIN SELECT RAISE(ABORT,'immutable history'); END;
CREATE TRIGGER wiki_pages_no_delete BEFORE DELETE ON wiki_pages BEGIN SELECT RAISE(ABORT,'archive pages instead'); END;
