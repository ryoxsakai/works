# Wiki 0002: Consoleの完全な1文を1回ずつ実行

一括貼付は本番Consoleでincomplete inputとなり、事後確認は旧schemaのまま（table3/index2/trigger6、folder_idなし、0001のみ、全9集計不変）。原因は実際の送信payloadを確認できておらず未確定だが、トリガー文が改行や内部セミコロンで途中分割された場合の同エラーをSQLiteで再現した。以下は各完全文を1行へ整形した原本同等SQLで、空DB・合成既存ページで1文ずつ適用して保持確認済み。本番Consoleでの単文適用の成否はMac側で確認する。

対象account/DB UUID・事前結果は[元の確認手順](wiki-console-0002.md)と同じ。現在schemaが上記旧schemaと一致している場合のみ開始する。作業中はWiki画面/MCPから保存しない。以下のブロックを**1つずつ**貼付→Execute→成功結果確認。コードブロック内に改行はない（画面上の折返しは問題ない）。内部のセミコロンも含めたCREATE TRIGGER〜最後のEND;が1つのSQL文であり、区切って実行しない。BEGIN/COMMIT/SAVEPOINTを追加しない。

エラー時はその番号で止まり、schemaとエラーを返す。成功済みCREATE/ALTER/DROPを再実行しない。9〜12は履歴作成trigger差替えなので全完了まで保存を再開しない。部分適用中のデータ操作・台帳登録・mergeをしない。

## 1

```sql
CREATE TABLE wiki_folders ( id TEXT PRIMARY KEY, parent_id TEXT REFERENCES wiki_folders(id), name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), CHECK(parent_id IS NULL OR parent_id<>id) );
```

## 2

```sql
CREATE INDEX wiki_folders_parent ON wiki_folders(parent_id,name,id);
```

## 3

```sql
CREATE UNIQUE INDEX wiki_folders_names ON wiki_folders(coalesce(parent_id,''),name COLLATE NOCASE);
```

## 4

```sql
ALTER TABLE wiki_pages ADD COLUMN folder_id TEXT REFERENCES wiki_folders(id);
```

## 5

```sql
CREATE INDEX wiki_pages_folder ON wiki_pages(folder_id,archived,updated_at DESC,id);
```

## 6

```sql
CREATE TRIGGER wiki_folder_revision BEFORE UPDATE ON wiki_folders WHEN new.id<>old.id OR new.revision<>old.revision+1 BEGIN SELECT RAISE(ABORT,'folder revision must advance'); END;
```

## 7

```sql
CREATE TRIGGER wiki_folder_insert_depth BEFORE INSERT ON wiki_folders WHEN new.parent_id IS NOT NULL BEGIN SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS ( SELECT id,parent_id,1 FROM wiki_folders WHERE id=new.parent_id UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM wiki_folders f JOIN ancestors a ON f.id=a.parent_id ) SELECT coalesce(max(depth),0) FROM ancestors)>15 THEN RAISE(ABORT,'folder depth limit') END; END;
```

## 8

```sql
CREATE TRIGGER wiki_folder_move_guard BEFORE UPDATE OF parent_id ON wiki_folders WHEN new.parent_id IS NOT NULL BEGIN SELECT CASE WHEN EXISTS(WITH RECURSIVE ancestors(id,parent_id) AS ( SELECT id,parent_id FROM wiki_folders WHERE id=new.parent_id UNION ALL SELECT f.id,f.parent_id FROM wiki_folders f JOIN ancestors a ON f.id=a.parent_id ) SELECT 1 FROM ancestors WHERE id=new.id) THEN RAISE(ABORT,'folder cycle') END; SELECT CASE WHEN (WITH RECURSIVE ancestors(id,parent_id,depth) AS ( SELECT id,parent_id,1 FROM wiki_folders WHERE id=new.parent_id UNION ALL SELECT f.id,f.parent_id,a.depth+1 FROM wiki_folders f JOIN ancestors a ON f.id=a.parent_id ) SELECT coalesce(max(depth),0) FROM ancestors)+(WITH RECURSIVE descendants(id,depth) AS ( SELECT old.id,1 UNION ALL SELECT f.id,d.depth+1 FROM wiki_folders f JOIN descendants d ON f.parent_id=d.id ) SELECT max(depth) FROM descendants)>16 THEN RAISE(ABORT,'folder depth limit') END; END;
```

## 9

```sql
DROP TRIGGER wiki_history_insert;
```

## 10

```sql
DROP TRIGGER wiki_history_update;
```

## 11

```sql
CREATE TRIGGER wiki_history_insert AFTER INSERT ON wiki_pages BEGIN INSERT INTO wiki_history(page_id,revision,snapshot) VALUES(new.id,new.revision,json_object('id',new.id,'revision',new.revision,'title',new.title,'body',new.body,'sources',json(new.sources),'tags',json(new.tags),'aliases',json(new.aliases),'links',json(new.links),'status',new.status,'archived',new.archived,'updated_at',new.updated_at,'folder_id',new.folder_id)); END;
```

## 12

```sql
CREATE TRIGGER wiki_history_update AFTER UPDATE ON wiki_pages BEGIN INSERT INTO wiki_history(page_id,revision,snapshot) VALUES(new.id,new.revision,json_object('id',new.id,'revision',new.revision,'title',new.title,'body',new.body,'sources',json(new.sources),'tags',json(new.tags),'aliases',json(new.aliases),'links',json(new.links),'status',new.status,'archived',new.archived,'updated_at',new.updated_at,'folder_id',new.folder_id)); END;
```

## 検証と台帳

12まで成功後、[元の手順の3・4](wiki-console-0002.md#3-適用後確認台帳を登録する前)の確認SQLを実行する。期待値table4/index5/trigger9計18、folder_id TEXTあり、folders=0、所属非NULL=0、foreign_key_check=0行、旧9数値不変。両history triggerのfolder_id保存とimmutable保護を確認し、その後だけ0002台帳を登録する。全成功を返すまで#103をmergeしない。

単文の完全な1行トリガーでも失敗する場合はConsoleの入力境界が未解決なので、同じ方法の再試行は止める。既存認証済みWranglerが利用できるなら原本SQLの正式なd1 execute/migrations経路を検討するが、新credential作成・権限拡張をしない。

一次情報: [Cloudflare workers-sdk #4998](https://github.com/cloudflare/workers-sdk/issues/4998)はmultiline triggerのincomplete inputとsingle-line/command経路の実例を含む（2026-09に修正報告あり、今回Consoleの原因確定とは扱わない）。[D1 SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements/)はConsole/CLI/Worker APIを正式なSQL実行経路として案内する。
