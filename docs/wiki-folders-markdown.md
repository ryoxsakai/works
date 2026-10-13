# Wiki: フォルダ階層とMarkdown

最新main e27f12b（Wikiテーマ対応公開後）を基準とする。トップ分類と全サービス共通ヘッダーは別担当PR #102（d5915d78）を統合済み。推奨merge順序は #102 → #103。Wiki機能側の表示名をWikiに統一する。

## 実装と再利用

教材管理のshared/styles.cssにあるmaterial-folder-card/open/copy、material-folder-grid、material-breadcrumb、material-tree-folder/children/file、view-toggleをWikiで再利用。ネイティブdetails/summaryによる折り畳みとapp-modal/modal-header/modal-actionsを用いた名称変更・作成・移動dialogを同じパターンで実装する。教材側のドラッグ操作はスマホでも確実に操作できる選択式移動dialogに置き換える。Wiki機能側は共通CSS・トップ・他アプリの認証を変更しない。統合したPR #102は共通ヘッダー・テーマ・分類表示を更新する。works_themeと共通paletteを維持し、独自theme保存キーを設けない。

フォルダ表示はパンくず、子フォルダカード、そのフォルダ内ページ。ルート所属ページは未分類。ツリー表示は左側の階層とページ、右側の内容。同名の兄弟フォルダを拒否。最大1000フォルダ・16階層。ツリーにページmetadataを直近2000件まで表示し、超過時は案内する。他のページも各フォルダの内容・全体検索から取得できる。検索は従来通り全フォルダ横断。フォルダ削除は今回追加しない。

フォルダ・ページの移動先はdialogで選び、循環候補は画面でも除外。source revisionと移動先revisionをSQL条件で検査する。DB triggerでも循環と、子孫を含む深さ制限を拒否する。ページ移動は本文を変更せずrevisionを1つ進め、folder_id込みsnapshotを保存。移動前の改稿案はrevision不一致で採用不可。復元は所属フォルダも過去の値へ戻し、旧snapshotにfolder_idがない場合は未分類へ復元する。旧履歴をUPDATE/DELETEしない。

ページ/フォルダのURLは?folder=ID&page=ID。パンくず・戻る・ブラウザ戻るを扱い、未保存入力は確認なしに破棄しない。処理中の移動/中断を抑制。dialogのEscape/キャンセルは未保存入力の確認を行い、競合後の入力を保持する。

## Markdown

以前の簡易描画（行ごとのp、箇条書きの記号、1行ずつのpre）を、Marked 18.1.1のGFM描画に変更。段落、見出し、太字/斜体/取り消し線、ネストしたリスト・番号付きリスト、引用、表、複数行コード、タスクリスト、HTTP(S)リンクを描画。編集/プレビューを切り替えて同じrendererで確認する。保存値は原文Markdownのまま。既存本文を変換しない。

生HTMLをrendererでescape、外部画像はaltテキストのみ、リンクはHTTP(S)・credentialなしに限定。ブラウザではDOMPurify 3.4.17のHTMLタグ/属性allowlistで追加sanitize。script/SVG/iframe/formや画像を出力しない。従来の保存APIのHTML/危険URL拒否も維持する。コード内でもHTMLタグ文字列の保存は従来通り拒否される場合がある。タスクcheckboxは表示専用でdisabledを維持。JSライブラリとライセンスはwiki/vendorへ同梱し、CDNや推論APIを使用しない。テストでpinしたnpm sourceとの同一性を確認する。

参照: https://marked.js.org/using_advanced 、 https://marked.js.org/using_pro 、 https://github.com/cure53/DOMPurify

## DBとMCP互換性

新migrationはworker/wiki-migrations/0002-wiki-folders.sqlだけ。wiki_folders、indexes、folder revision/cycle/depth triggerを追加し、wiki_pagesにnullable folder_id+indexを追加する。page history insert/update triggerを差し替えて以後のsnapshotにfolder_idを含める。既存ページの本文・出典・タグ・別名・リンク・revision・履歴JSONはそのまま、所属だけNULL=未分類となる。既存DB/tutor-db/materials-dbのschemaは変更しない。

MCPの4ツール名・必須引数・scopeを変更しない。従来のsearchは全フォルダ、createは未分類の下書き、proposalは本文変更のみ。get/searchにはfolder_idが追加される。新しいフォルダ作成/移動はブラウザ認証のRESTに限定し、MCPの権限を増やさない。新しいcredential・有料設定を設けない。

## migration手順（公開承認後）

今回はmerge/deploy/remote migrationを実施しない。新コード公開前に、既存認可済みの環境で専用Wiki migrationを適用する。

```sh
cd worker
CLOUDFLARE_ACCOUNT_ID=a65361433fe11677025317c13697b432 npm run wiki:migrate -- --remote a6e45689-9835-4ef5-aa34-06130be32bee
```

対象はWIKI_DB/works-wiki-dbだけ。d1_migrationsの0001-wiki.sqlは既存登録済みなので、0002のみ適用される。既存db:migrateやtutor-dbへのSQL実行を使わない。Consoleの場合は原本0002-wiki-folders.sqlを新Wiki DBだけに実行し、全成功後にd1_migrationsへ0002-wiki-folders.sqlを記録する。新credentialが必要なら停止する。旧コードでも追加nullable列は読み取れるため、migrationを先に行う。新コードは未migrationを503としてWikiだけ利用不可にする。

検証: wiki_foldersの空テーブル、wiki_pagesの既存row数・body/revisionが不変、旧wiki_historyのsnapshotが不変、page history triggerにfolder_idが含まれることを確認する。rollbackは旧コードへ戻す（追加DB schemaはそのまま）。破壊的なDB巻き戻しは行わない。

## 検証結果

全API/セキュリティ/回帰61テスト成功。PC/390px・ライト/ダーク4シナリオでフォルダ作成/名称変更/移動、ページ移動、競合入力保持、ネストツリー、Markdown preview/XSS、未保存の画面切替/戻る/Escapeを確認。独立レビュー・独立ブラウザ再実行も成功し、重大指摘なし。ローカルWranglerで既存0001台帳を残し0002だけ適用する手順も検証。実DBには適用していない。
