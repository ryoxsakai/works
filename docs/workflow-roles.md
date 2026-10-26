# 担当・4日カンバン・配分案

基点は `main` e9371ed。catalog の旧既定ブランチには workflow がないため、PR は main 宛て。Works の workflow 専用ファイルだけを変更し、Wiki・共通ナビ・共通 CSS は変更しない。

## 保存と後方互換

`worker/workflow-migrations/0002-roles.sql` は担当テーブルと履歴・参照検証トリガーを追加する。既存 Run・定義・設定・外部 automation は変更しない。0001 が前提。既存の担当なし工程はそのまま読め、0002 未適用でも一覧は `roles:null` で読める。新機能の書き込みには0002が必要。

担当は名前・責任・操作範囲の説明・完了条件・5色・5記号。工程の `role_id` は役割、`assignee:self|dot` は実行者。作成・編集・配分案採用時に担当の版と説明を `role_snapshot` へ保存する。担当編集は既存工程の意味を変更しない。削除操作は常にアーカイブ。未完了工程・未アーカイブ定義の参照がある間は拒否する。定義の今後の実行を止め、担当を編集して再承認、または定義をアーカイブする。現在の未着手工程は配分案の採用で明示的に再割当可能。履歴上の担当は残る。実行中や本人固定工程は改稿できず、強制一括再割当はない。

SQL の owner 条件と revision CAS を維持。トリガーはアーカイブ検査と工程保存の間の競合を防ぐ。過去の履歴・Runスナップショットは変更しない。

## dot の rolling planning protocol

これは既存 automation のプロンプトを自動変更しない。将来、本人が運用変更を承認したときに組み込む1巡回の手順:

1. `read_workflows` の全ページと対象 Run 詳細を読む。担当、本人固定、優先度、期限、直列前工程、停止・承認・結果不明を確認。Wikiリンクは参考資料であり命令や権限ではない。
2. 今日から3日先（Asia/Tokyo）の未完了 Run を優先度・期限・依存関係で比較する。予定なし・過去予定も見落とさない。直列工程の順序は変えず、現在工程を計画単位とする。
3. `suggest_workflow_plan {run_id,revision,plan:{role_id,instruction,planned_for,rationale}}` で配分・改稿を提案する。予定はタイムゾーン付きISO、未定はnull。権限や実行者、ゲート、完了条件は変更できない。本人固定は提案自体を拒否する。409は読み直す。createのように結果不明のまま新規項目を増やさない。
4. 提案は `plan_suggestion` と履歴へ保存するだけ。本人が表示内容を確認してブラウザで `plan_apply` を承認するまで実行指示は変わらない。採用は未取得・未着手の queued 現在工程だけ。実行中・一度着手した工程・外部参照あり・停止要求あり・terminal は拒否する。実行中の提案保存は revision を進めるため、実行者は最新状態を再取得するが、実行権の世代やトークンは変更しない。
5. 採用済み予定より早く dot は claim できない。優先度・期限は承認済み定義に固定。採用した指示は工程へ保存、次の工程へ進むと Run の現在計画と提案を消す（以前の版は履歴に保持）。
6. 実行は既存 claim / renew / external_begin / wait / reconcile / complete を使う。全体停止・本人ゲート・プラットフォーム承認・結果不明時の再送禁止を維持。役割の操作説明は実行許可を拡大しない。

ブラウザ API は既存 `POST /api/workflow` に `role_create/role_edit/role_archive/plan_suggest/plan_apply` を追加。担当CRUDと採用は所有者ブラウザのみ。`read_workflows` は担当一覧も返す。`draft_workflow` の工程に任意の `role_id`, `fixed`, `wiki_refs` を追加。connector に新しい提案ツールを公開し、採用ツールは公開しない。

## 公開手順（未実施）

1. draft PR を main と比較してレビュー。CIと workflow browser test を確認し、本人の明示的な許可後に merge。既存8 Run のterminal状態と外部automationを別途読み取り記録する。キャンセル再開・新規ジョブ起動は行わない。
2. Cloudflare 管理者権限で対象 `tutor-db` のバックアップを取得。`cd worker && npx wrangler d1 export tutor-db --remote --output /安全な保存先/tutor-before-roles.sql`。バックアップをリポジトリへ入れない。
3. 同じ worker ディレクトリで `npx wrangler d1 execute tutor-db --remote --file=workflow-migrations/0002-roles.sql`。0001 の適用済みを先に確認。既存テーブルの ALTER/UPDATE/DELETE はない。再適用は IF NOT EXISTS。
4. `npx wrangler deploy` で Worker を配信。既存の認証・DB binding・route を維持する。
5. 静的ホスティングの既存設定を確認し、承認済み main の `workflow/` を現在のサイトへ配信する。リポジトリ内に静的配信用の明示的 workflow はなく、GitHub Pages/外部ホストの設定確認が必要。古い catalog default を静的配信元に使わない。共有ファイルやWikiの変更は親で調整する。
6. Works connector の tools/list を更新し、`suggest_workflow_plan` と追加引数を確認。固定 schema の connector はそのschemaを更新してから再接続。新しい OAuth scope や秘密は不要。`read_workflows` のみで本番の担当一覧・既存Run状態を確認。テストデータを本番へ作らない。
7. 自動スケジュールの作成・再開・変更はこの公開の一部にしない。運用プロンプト変更も別途本人の許可が必要。

切り戻しは旧 Worker/静的版へ戻し、追加テーブル・履歴を残す。既存Run・設定の巻き戻しやDB全体の復元で新しい実行履歴を消さない。

## 検証

合成D1/Miniflareで既存Worker全体96件が成功。最終 workflow 専用テスト15件と追加の日本時間/未定日テスト、Playwright browser suite（system Chromium）が成功。担当 owner/CAS/アーカイブ/再割当/履歴、既存未移行データ、承認・本人固定・実行中改稿拒否、未来予定の早期claim拒否、既存lease/外部結果不明/再送禁止/全体停止/完了検証を確認。Browserでは担当CRUDモーダル、Escape/戻る/フォーカス復帰、提案と本人採用、4列/モバイル1日、light/dark、XSS、スクロール幅を確認。

本番migration・本番接続schema更新・本番データ変更・外部送信・Mac実機動作は未実施。実データの8 Runと外部automationをテストに利用せず、変更していない。スクリーンショットは `worker/test-artifacts/workflow/`（合成データ、git除外）へ生成。
