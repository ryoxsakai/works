# Works メモ

調査元: memory main 152db685567bd741692d4f2e35ad2f9625f4ca10。
Works 基準: main 5517b469ad1191130299847deeabcba6a6e4bed8 (PR102)。両repoに .agents/skills / AGENTS.md はありません。
memory の CLAUDE.md は古いToDo構造を記載しているため、実コードを優先しました。

## 機能対応

|memory|Works メモ|
|---|---|
|メモ作成・編集・削除、カード一覧、閲覧|移植|
|複数本文、本文追加・削除・上下移動|移植。閲覧は点線で区切る|
|複数補足、タグ追加・削除・絞り込み|移植|
|カテゴリ追加・改名・削除・順序、メモ上下移動|移植|
|本文コピー、URLリンク化、作成日・更新日|移植|
|Firebase Google Auth|Works既存ブラウザセッション|
|Firestore users/{uid}/memory/main、onSnapshot|既存D1に独立memo_state、revisionで競合検出|
|localStorageキャッシュ・未送信バッファ|本文をlocalStorageへ保存しない。保存失敗時は画面に保持し未保存JSONをダウンロード可能|

即時クラウド保存は維持。Firestoreリアルタイム購読は使用せず、他画面の更新は再読み込みで取得し、古いrevisionからの上書きを409で拒否します。
ToDo stylesheetをshared/task-ui.cssへ抽出し、todo/todo.cssの互換importとメモから共用。パネル、カテゴリタブ、入力、モーダル、ライト/ダークのパレットを再利用。PR102 shared/header、theme-init、works_theme、ホームログイン導線を使用。新規外部サービス・認証scope追加なし。memory自体は無変更。

## DB適用（未実施）

新しいDB/bindingは不要。既存 tutor-db / DB へ次の独立migrationを適用します。Wikiの0002やKDP migrationsには混ぜません。

```sh
cd worker
npx wrangler d1 execute tutor-db --local --file=memo-migrations/0001-memo.sql
# 本番公開の承認後、既存DBへ:
npx wrangler d1 execute tutor-db --remote --file=memo-migrations/0001-memo.sql
```

本番ではmigration → Worker → Pagesの順で適用。未適用ではメモ画面が読込エラーを表示し、自動作成や別保存先への切替は行いません。既存DBにテーブル追加のみ。資格情報、権限、OAuth redirect追加は不要（ログインは既存/tutor/ callback利用）。

## 個人データ移行（確認待ち）

機能移植に既存データ転送は含めません。希望時は本人がFirebase users/{uid}/memory/mainからmemos/categoriesだけをJSON出力し、対象UID・件数・転送先・既存メモとの重複方針を確認します。旧body/noteをbodies/notesに変換、IDと順序・日付を保持し、検証・バックアップ後に既存D1へrevision付きで一度だけ保存する方式を提案します。移行ツールや本番転送は本PRでは提供・実行しません。

メモのutility CSSはTailwind 3.4.17で静的生成したmemo/utilities.cssを同梱し、実行時Tailwind CDNに依存しません。ToDo既存CDN設定は変更しません。再生成はTailwind 3.4.17 CLIでmemo/index.htmlとmemo/app.jsをcontent対象とし、preflight:false、@tailwind utilitiesのみを使用します。
