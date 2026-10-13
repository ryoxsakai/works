# Wiki 0002: 原本7〜12を既存Wranglerで完了

対象account `a65361433fe11677025317c13697b432`、works-wiki-db UUID `a6e45689-9835-4ef5-aa34-06130be32bee`。Macで既存OAuth/account/d1 write、wrangler4.107.0、対象DB名/UUID一致を確認済み。新login・credential・権限は不要。

Consoleで1〜6成功・7失敗、8〜12未実行。table4/index5/trigger7=16、folder_id TEXTあり、旧history insert/update維持、保持9集計不変、0001台帳のみ。**0002全体、0001、wiki:migrateを実行しない。** migration台帳が未完了なのでmigration applyでは成功済み1〜6が再適用される。

[残りSQL](../worker/wiki-recovery/0002-remaining.sql)は原本0002のCREATE TRIGGER wiki_folder_insert_depthからEOFまでを文字通り切り出したもの。6文で、CASE/CTE/深さ/循環保護を変更していない。migrations_dir外に置き、通常migrationとして二重登録されない。空/合成既存データで1〜6適用済みschemaから完了と保持を検証済み。

## 1. Macで直前確認（読取のみ）

Wiki画面/MCPでの保存・提案登録は実行完了まで行わない。Consoleまたは同じ既存Wranglerで以下を確認し、不一致なら止める。

```sql
SELECT name FROM d1_migrations ORDER BY id;
SELECT type,name FROM sqlite_master WHERE name GLOB 'wiki_*' ORDER BY type,name;
PRAGMA table_info(wiki_pages);
SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('wiki_folder_revision','wiki_folder_insert_depth','wiki_folder_move_guard','wiki_history_insert','wiki_history_update','wiki_history_immutable_update','wiki_history_immutable_delete');
```

期待:0001のみ、計16。folder_revisionあり、folder_insert_depth/move_guardなし。旧history_insert/updateは存在しsnapshotにfolder_idなし、immutable両triggerあり。直前の保持9数値も[元手順1](wiki-console-0002.md#1-事前確認読取のみ)の集計SQLで再確認する（今回全0）。

## 2. 残りだけCLIで実行

検証済みcommitの残りSQLを`/tmp/works-wiki-0002-remaining.sql`へ保存し、原本の7〜12と一致を確認する。既存CLIを使い、accountとUUIDを明示する。

```sh
CLOUDFLARE_ACCOUNT_ID=a65361433fe11677025317c13697b432 /opt/homebrew/bin/wrangler d1 execute a6e45689-9835-4ef5-aa34-06130be32bee --remote --file=/tmp/works-wiki-0002-remaining.sql
```

正式なD1 SQLファイル実行。独自の手動BEGIN/COMMITやConsole分割は使用しない。通常の実行確認表示を読み、同じ対象UUIDであることを照合する。エラーなら止めてschemaを再読取し、完了した文を識別する。残りファイル全体を再実行しない。Cloudflareが自動rollbackしたと仮定しない。認証/接続が要求されるなら新loginせず止める。

## 3. 保持確認→台帳

[元手順3・4](wiki-console-0002.md#3-適用後確認台帳を登録する前)を順に実行。table4/index5/trigger9=18、folder_id TEXT、folders0、所属非NULL0、FKcheck0行、9数値不変、両history triggerのfolder_id保存、immutable保護を確認後だけ台帳へ0002-wiki-folders.sqlを登録する。台帳0001/0002各1行を確認して担当へ返す。

台帳/保持確認が完了するまで#103をmergeしない。復帰は旧コードと追加schema維持、データ行・履歴の削除/巻き戻しは行わない。これは部分適用の修復専用であり、完全に適用済みDBには残りSQLを実行しない。

公式: [wrangler d1 execute](https://developers.cloudflare.com/d1/wrangler-commands/#execute)、[D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)。CLIのSQL splitterはBEGIN/CASEを扱うため、Consoleの入力境界と分離して正式経路で実行する。本番CLI結果はMac側で確認する。
