# Wiki 0002: Cloudflare D1 Console手順

対象account `a65361433fe11677025317c13697b432` → D1 SQL database → **works-wiki-db** → Console。画面でDatabase ID **a6e45689-9835-4ef5-aa34-06130be32bee** を照合する。SQLだけではUUIDを判別できない。tutor-db / works-materials-dbは対象外。

PR #102は公開済み。PR #103はDB検証までmerge保留。作業中はWikiの画面・MCPから保存／提案登録をしない（自動停止の設定変更は不要）。本文を出力・コピーする必要はない。各確認結果の数値だけ控える。原本0002と同じDDLを下に掲載する。初回0001を再実行しない。

## 1. 事前確認（読取のみ）

```sql
SELECT name FROM d1_migrations ORDER BY id;
SELECT type,name FROM sqlite_master WHERE name GLOB 'wiki_*' ORDER BY type,name;
PRAGMA table_info(wiki_pages);
SELECT
 (SELECT count(*) FROM wiki_pages) AS pages,
 (SELECT coalesce(sum(revision),0) FROM wiki_pages) AS page_revision_sum,
 (SELECT coalesce(sum(length(CAST(body AS BLOB))),0) FROM wiki_pages) AS body_bytes,
 (SELECT coalesce(sum(length(CAST(title AS BLOB))+length(CAST(sources AS BLOB))+length(CAST(tags AS BLOB))+length(CAST(aliases AS BLOB))+length(CAST(links AS BLOB))+length(CAST(status AS BLOB))+length(CAST(updated_at AS BLOB))),0) FROM wiki_pages) AS metadata_bytes,
 (SELECT coalesce(sum(archived),0) FROM wiki_pages) AS archived_pages,
 (SELECT count(*) FROM wiki_history) AS history,
 (SELECT coalesce(sum(length(CAST(snapshot AS BLOB))),0) FROM wiki_history) AS history_bytes,
 (SELECT count(*) FROM wiki_proposals) AS proposals,
 (SELECT coalesce(sum(length(CAST(content AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(status AS BLOB))),0) FROM wiki_proposals) AS proposal_bytes;
```

続行条件: 台帳は0001-wiki.sql登録済み・0002未登録。wikiオブジェクトはtable=3、index=2、trigger=6、計11。wiki_pagesにfolder_idなし。件数は0とは限らないので現在値を控える。不一致・エラーならここで止める。既に0002ありの場合は再適用せず3の検証へ。

## 2. 0002を適用（初回1回だけ）

以下のブロック全体をConsoleへ貼りExecute。成功結果を確認する。データ行のUPDATE/DELETE、DROP TABLEはない。DROP TRIGGERは履歴作成triggerの差し替えのみで、既存履歴の更新・削除拒否triggerは維持する。

```sql
CREATE TABLE wiki_folders (
 id TEXT PRIMARY KEY, parent_id TEXT REFERENCES wiki_folders(id), name TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(parent_id IS NULL OR parent_id<>id)
);
CREATE INDEX wiki_folders_parent ON wiki_folders(parent_id,name,id);
CREATE UNIQUE INDEX wiki_folders_names ON wiki_folders(coalesce(parent_id,''),name COLLATE NOCASE);
ALTER TABLE wiki_pages ADD COLUMN folder_id TEXT REFERENCES wiki_folders(id);
CREATE INDEX wiki_pages_folder ON wiki_pages(folder_id,archived,updated_at DESC,id);
CREATE TRIGGER wiki_folder_revision BEFORE UPDATE ON wiki_folders WHEN new.id<>old.id OR new.revision<>old.revision+1 BEGIN SELECT RAISE(ABORT,'folder revision must advance'); END;
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
```

Consoleが複数文を受け付けない場合: エラー後は全体を再実行しない。1のオブジェクト/列を再確認し、成功済み文を識別して担当へ返す。必要なら未実行文だけを原本順に実行するが、各CREATE TRIGGER〜対応END;は完全な1文として扱い、内部セミコロンで分割しない。特に履歴triggerのDROP〜CREATEの間は保存を再開しない。

手動BEGIN/COMMIT/SAVEPOINTを付け足さない。公式Consoleは複数文の貼付実行を案内しているが、今回のConsole一括実行や別々のExecute全体の原子性・エラー時rollbackは実環境で保証できていない。Worker API batchのrollback保証をConsoleへ読み替えない。途中失敗時は台帳登録・mergeをせず、現在schemaとエラーを返す。自動再試行・DROP/DELETEによる巻き戻しはしない。

## 3. 適用後確認（台帳を登録する前）

```sql
PRAGMA table_info(wiki_pages);
SELECT type,name FROM sqlite_master WHERE name GLOB 'wiki_*' ORDER BY type,name;
SELECT count(*) AS folders FROM wiki_folders;
SELECT count(*) AS non_null_folder_pages FROM wiki_pages WHERE folder_id IS NOT NULL;
SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('wiki_history_insert','wiki_history_update','wiki_history_immutable_update','wiki_history_immutable_delete','wiki_pages_no_delete');
PRAGMA foreign_key_check;
SELECT
 (SELECT count(*) FROM wiki_pages) AS pages,
 (SELECT coalesce(sum(revision),0) FROM wiki_pages) AS page_revision_sum,
 (SELECT coalesce(sum(length(CAST(body AS BLOB))),0) FROM wiki_pages) AS body_bytes,
 (SELECT coalesce(sum(length(CAST(title AS BLOB))+length(CAST(sources AS BLOB))+length(CAST(tags AS BLOB))+length(CAST(aliases AS BLOB))+length(CAST(links AS BLOB))+length(CAST(status AS BLOB))+length(CAST(updated_at AS BLOB))),0) FROM wiki_pages) AS metadata_bytes,
 (SELECT coalesce(sum(archived),0) FROM wiki_pages) AS archived_pages,
 (SELECT count(*) FROM wiki_history) AS history,
 (SELECT coalesce(sum(length(CAST(snapshot AS BLOB))),0) FROM wiki_history) AS history_bytes,
 (SELECT count(*) FROM wiki_proposals) AS proposals,
 (SELECT coalesce(sum(length(CAST(content AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(status AS BLOB))),0) FROM wiki_proposals) AS proposal_bytes;
```

期待値: folder_id TEXT列あり、table=4・index=5・trigger=9（計18）。folders=0、non_null_folder_pages=0。history_insert/updateはfolder_idをsnapshotへ保存。immutable_update/deleteとpages_no_deleteは引き続き存在。foreign_key_checkは0行。1で控えた全9数値と一致（作業中に保存が行われた場合は止めて確認）。集計値は同一本文の暗号学的証明ではないが、DDLが既存データ行を変更しないことはローカルmigration試験で確認済み。

## 4. 全成功・データ保持確認後だけ台帳を登録

```sql
INSERT INTO d1_migrations(name)
SELECT '0002-wiki-folders.sql'
WHERE EXISTS(SELECT 1 FROM d1_migrations WHERE name='0001-wiki.sql')
 AND NOT EXISTS(SELECT 1 FROM d1_migrations WHERE name='0002-wiki-folders.sql')
 AND EXISTS(SELECT 1 FROM pragma_table_info('wiki_pages') WHERE name='folder_id' AND type='TEXT')
 AND (SELECT count(*) FROM sqlite_master WHERE name IN (
 'wiki_pages','wiki_history','wiki_proposals','wiki_pages_recent','wiki_proposals_page',
 'wiki_history_insert','wiki_history_update','wiki_revision_guard',
 'wiki_history_immutable_update','wiki_history_immutable_delete','wiki_pages_no_delete',
 'wiki_folders','wiki_folders_parent','wiki_folders_names','wiki_pages_folder',
 'wiki_folder_revision','wiki_folder_insert_depth','wiki_folder_move_guard'))=18
 AND (SELECT count(*) FROM sqlite_master WHERE type='trigger' AND name IN ('wiki_history_insert','wiki_history_update') AND instr(sql,'''folder_id''')>0)=2;
SELECT name FROM d1_migrations ORDER BY id;
```

台帳結果に0001-wiki.sqlと0002-wiki-folders.sqlの両方が各1行あれば完了。判定が不一致ならINSERTは0行となるため、成功表示だけで完了と判断しない。3の数値・schema確認と4の台帳結果を担当へ返す。その後に#103 merge、通常CD、ログイン済み画面のフォルダ/本文/履歴を確認する。

## 復帰と検証範囲

0002の追加schemaは旧コードと互換。公開後の不具合は#103導入前のコードへ戻し、DBは維持する。既存履歴や本文を消すDB rollbackはしない。部分DDL失敗はschemaを確認して未完了文を補う方針で、破壊的復帰をしない。

原本DDLは隔離ローカルD1/WranglerおよびSQLiteで既存本文・revision・旧snapshot保持を検証。上記確認/台帳SQLはSQLiteで空DBと既存合成ページの両方を検証。Cloudflare Consoleの本番実行自体は未確認（認証済みユーザーが実施）。新credential、binding、DB作成、課金設定は不要。

公式根拠（2026-10-13確認）: [Consoleで複数SQL貼付→Execute](https://developers.cloudflare.com/d1/get-started/#create-a-table-and-populate-it-with-data)、[Worker API batchのtransaction/rollback保証](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)、[migration台帳](https://developers.cloudflare.com/d1/reference/migrations/)。BEGIN禁止のConsole個別挙動は未確認のため、追加せず公式のSQL貼付手順を用いる。
