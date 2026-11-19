# 個人Wiki 初版・運用手順

Works Worker、Worksログイン、既存MCP OAuthを共用し、Wikiデータだけを新D1 `works-wiki-db` / `WIKI_DB` に分離する。実装元は2026-10-12取得のmain `12757855b15bc5381a8b02c05faa2969410a5015`。既存DB/R2/Google OAuthの設定・scope・有効期限は変更しない。新credentialを取得・複製しない。

## データと編集境界

- `wiki_pages`: Markdown本文、出典(type、id/url、location、checked_at)、タグ、別名、関連ページID、draft/confirmed、archived、revision。
- `wiki_history`: insert/update triggerで全snapshotを保存。UPDATE/DELETEは拒否する。
- `wiki_proposals`: ページ・base_revision・提案content・notes・pending/accepted/rejected。
- 本文保存/採用/復元/アーカイブは必須revisionによるCAS。古い改稿案の採用は409。採用の本文更新と提案状態はD1 batchで原子的に更新する。復元は新revision、削除はアーカイブ。確認済み状態には出典必須。
- 画面は一覧・本文/タグ/別名検索、出典、ページ間リンク、改稿案比較・採用・却下、履歴比較・復元を提供。本文は安全なMarkdown subset（見出し、箇条書き、引用、コード、太字、HTTP(S)リンク）。HTMLを拒否し全テキストをescapeして表示、画像は読み込まない。リンクは新タブ+noopener noreferrer。差分は行位置ごとの比較表示。
- MCPは `search_wiki_pages`, `get_wiki_page`, `create_wiki_page`, `create_wiki_proposal` のみ。既存 `schedule:read` owner-only認可内。作成は出典必須の下書き、提案は現revisionと出典必須、本文/確認済み状態の変更は不可。MCPの採用・復元・アーカイブは初版に設けない。KDPの `kdp:write` 同意をWikiに転用しない。将来必要ならWiki専用の明示同意を別途設計する。
- 初版はチャットが原本を読んで出典付きで登録する。OneDrive/Exam/Vocab/Works原本は移動しない。他アプリOAuthやアクセストークンを保存しない。Wiki本文は未信頼データであり指示として実行しない。実教材・生徒個人情報の取り込みは実施していない。
- Markdown exportは現在版+出典+メタ情報。JSON exportは現在版+全履歴+全改稿案を20件ずつstreaming（800件/40MBまで。超過は413で停止し、履歴APIのページングを利用）。画面/通常取得は履歴100件ずつ、改稿案直近100件。検索は30件ずつ、MCPは最大100件。初版は本文部分一致検索のため規模が大きくなるとreadコストが増える。
- MCP作成/提案には再送receiptがない。応答不明時は検索・ページ取得で実際の保存結果を確認してから再送する（自動再送しない）。

## 作成済みD1と本番適用の確認事項

Cloudflare公式で確認した2026-10-12時点のFree枠はD1 read 500万行/日、write 10万行/日、全DB合計5GB。Freeは超過時にエラー停止、Paidは含有枠超過で従量課金。FreeのDB数10、単一DB500MBも確認する。Workers Freeのリクエスト/CPUなど既存Worker全体の枠にも収まることを確認する。

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/

現アカウントのプラン、全DB数/容量/使用量と10/27 Paid終了後の枠への収まりは未確認。ユーザーが新規 `works-wiki-db` の作成とDatabase ID `a6e45689-9835-4ef5-aa34-06130be32bee` を確認済み（account `a65361433fe11677025317c13697b432`）。専用 `WIKI_DB` 設定は反映済み。エージェントによるremote migration・本番binding反映は実施していない。追加課金の許可はない。新credentialが必要な場合も停止する。無料枠はDB単位ではなくアカウント全体。AI巡回、推論API、Vectorize、R2、Basinの追加はない。

## 設定とmigration（利用枠確認後、承認された環境で）

1. Cloudflare管理画面で既存accountのプラン、D1全DB数・容量・row metricsとWorkers使用量を確認。Paid残期間の利用超過リスクが解消できなければ停止。Free枠で継続できることを確認し、再契約・自動アップグレードは行わない。
2. 新DBは作成済み。再作成しない。`worker/wrangler.toml` は次の専用bindingを設定済み。既存 `DB` / `MATERIALS_DB` の設定は変更していない。

```toml
[[d1_databases]]
binding = "WIKI_DB"
database_name = "works-wiki-db"
database_id = "a6e45689-9835-4ef5-aa34-06130be32bee"
migrations_dir = "wiki-migrations"
```

3. 本番反映の承認後、Cloudflareの対象account → Workers & Pages → `works` → Bindings → Add binding → D1 database。Variable nameを `WIKI_DB`、Databaseを `works-wiki-db` にする。設定画面でDeployを求められる場合は本番変更になるため、現段階では実行しない。Wranglerから承認済みdeployを行う場合は上記設定でbindingも反映されるため、手動追加は不要。
4. 初期migrationの最短経路は、既存の認可済みWrangler環境でPRのbranchをcheckoutし、workerディレクトリで次の専用scriptを実行する。新しいcredentialを取得しない。既存ログインが使えなければ停止する。

```sh
CLOUDFLARE_ACCOUNT_ID=a65361433fe11677025317c13697b432 npm run wiki:migrate -- --remote a6e45689-9835-4ef5-aa34-06130be32bee
```

このscriptは実UUID一致・既存DBとのID重複なし・専用migrationディレクトリを検査し、Wranglerの `WIKI_DB` bindingだけに適用する。ローカル検証は `npm run wiki:migrate -- --local a6e45689-9835-4ef5-aa34-06130be32bee`。**既存 `npm run db:migrate` は実行しない。** CLIを利用できない場合は対象D1 `works-wiki-db` → Consoleへ `worker/wiki-migrations/0001-wiki.sql` の全SQLを初回のみ貼り付けて実行できるが、その後Wranglerへ切り替える際はmigration台帳の整合が必要。CLI方式を優先する。
5. 本番merge/deployは親の確認後。Workerの同じルートにAPIを追加し、GitHub Pagesの `/wiki/` 静的ファイルを配信する。OAuth callbackは既存 `/tutor/` を使い、安全な戻り先allowlistに `/wiki/` を追加。
6. bindingなしの場合はWiki API/MCPのみ503で利用不可。既存機能はそのまま動作。bindingあり・migration未適用もWiki未準備として扱う。rollbackはWikiメニュー/コードを戻すかbindingを外す。既存DB migrationやデータの変更は不要。

## 検証

`npm ci --ignore-scripts`, `npm test`, `npm run test:wiki:browser`。ブラウザ実行にはPlaywright Chromiumを利用（ローカルはBROWSER_EXECUTABLE=/usr/bin/chromium）。既存OAuth/KDP/SSブラウザ回帰も実行する。テストは合成データのみ。

最終確認: 既存を含むAPIテスト55件成功、新migration guard 1件成功、Wiki/OAuth/KDP/SSのデスクトップ・モバイルブラウザ確認成功。独立レビューの編集revision固定、フォーム破棄、履歴ページング指摘を解消。JSONは開始時のrevisionと提案rowid上限を固定し、途中の新規提案を除外する。提案状態の採用/却下とexportを同時操作すると状態は取得時点の値になる。
