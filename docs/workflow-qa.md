# ワークフロー MVP 検証記録

2026-10-19、サンプル専用の Miniflare D1 と Playwright の合成 Origin で実施。本番の授業・Wiki・ToDo、Exam、Vocab はテスト編集していない。

- Worker 全体: 87/87 成功。最終の新機能変更後にもワークフローの5シナリオを再実行し5/5成功。
- Tutor: 45/45 成功。認証後の安全な戻り先に `/workflow/` を追加する既存テストも成功。
- ワークフローのブラウザ: 1440px／390px、ライト／ダーク、週／1日、前後日、下書き作成・編集、XSS、本人による公開、手動実行、一時停止・再開、希望間隔と実際の間隔の分離、ゲートでの証拠必須、本人確認・完了、全体停止・解除、トップのカテゴリ移動を成功確認。合成データへの書き込み11回。
- 共通ヘッダー: 10画面 × 6画面幅 × ログイン状態2種 = 120パターン、それぞれライト／ダーク／印刷を成功確認。テーマ保存、別タブ同期、OS追従、ナビガード、カテゴリも確認。
- Wrangler `deploy --dry-run`: 成功。実配信ではない。
- `git diff --check`: 成功。

実行したコマンド・ログ（この実行環境）:

- `node --test worker/test/*.test.mjs` → `/tmp/works-tests-release.log`
- `node --test tutor/test/*.test.mjs` → `/tmp/works-tutor-tests.log`
- `node --test worker/test/workflow.test.mjs` → `/tmp/works-workflow-tests-release.log`
- `BROWSER_EXECUTABLE=/usr/bin/chromium node worker/test/workflow-ui.browser.mjs` → `/tmp/works-workflow-browser-verified.log`
- `cd worker && BROWSER_EXECUTABLE=/usr/bin/chromium node test/header-theme.browser.mjs` → `/tmp/works-header-browser-final.log`
- `cd worker && npx wrangler deploy --dry-run --outdir /tmp/works-worker-build-release` → `/tmp/works-build-release.log`

スクリーンショットは `worker/test-artifacts/workflow/desktop.png`、`mobile-dark.png`（gitignore 対象）。画面を実際に確認済み。

重点検証: 同一予定回の二重作成防止、原子的な claim、revision 競合、所有者分離、ブラウザ／MCPトークン分離、Origin検査、本人だけの実行許可、順序と自分担当の保護、確認ゲート、成果物と条件確認、今後の予定停止と今回中止の分離、全体停止による世代無効化、実行権期限切れの待機、結果不明の再送拒否、同じ外部参照の照合、未送信を証明した後だけの同一参照再試行、途中結果・実行権更新、履歴から実行権トークンを除外。

発見・修正: 既存テストの新 import 解決と Wiki の新カテゴリへの期待値を更新。新画面のログイン戻り先を許可。非同期で Run を再取得中に閉じたダイアログが再表示される競合を防ぎ、ブラウザテストは本文全体の「未着手」ではなく Run 自身の状態を検証するよう修正。最終ブラウザ再実行成功。

未確認: Cloudflare 本番マイグレーション・Worker 実配信、GitHub Pages の配信設定／実配信、公開 MCP の親側ツール反映・実呼び出し、実 automation の稼働、実外部サービスへの送信。Cloudflare 未認証のため公開段階は保留。設定手順と制限は `workflow-management.md` を参照。


## 追加の安全修正

- `external_result` と `reconcile` の両方で、外部操作の completed → unknown／not_started を409で拒否。拒否後に版番号や保存内容が変わらないこと、待機・本人再開後にも同じ完了済み参照を再送できないことを検証。
- cancel → stop_all → reconcile の completed／not_started の両経路で requested_stop=cancelled を維持し、Run が cancelled に確定することを検証。
- 追加3本は修正前にすべて失敗。修正後のワークフローテストは8/8成功、Worker の dry-run ビルドも成功。追加マイグレーションは不要。
- 親からの現状報告では初版の Worker と追加 SQL だけが本番に入り、静的画面・定期実行は未公開。この安全修正のマージ・配信はクラウド側では実施せず、Mac 再接続後の担当へ引き継ぐ。
