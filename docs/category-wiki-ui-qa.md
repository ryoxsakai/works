# メモ・ToDo・Wiki UI / KDP ヘッダー検証

基準: `main` の `b6326fe5b87471be18bfa57397259df6975b91c5`。本番データ・認証情報は使用せず、ブラウザは合成オリジン・API/DBで検証。

## 変更

- メモ・ToDo のカテゴリタブを共通 CSS で左右 16px / 最小高さ 44px に統一。メモでは共通 `.tab-btn` が先に読み込んだユーティリティの左右 padding を上書きしていたため、対象を限定した共通指定で解消。
- カテゴリ管理を共通 native dialog コントローラーに統一。操作ボタンを常時表示し、ラベル・44px の操作領域・スマホ2行レイアウト・空状態を追加。Tab/Shift+Tab、改名のキャンセル、Escape、背景クリック、閉じた後とリスト再描画後のフォーカスを維持。
- Wiki は共通の配色・フォルダ部品・モーダルを使用したまま、一覧・ツリー・閲覧・編集の余白、情報階層、主要操作、読みやすさを調整。現在ページの `aria-current` と選択表示、検索空状態を追加。既存の階層・移動・Markdown・関連ページ・認証・履歴・比較・復元処理は保持。
- KDP の汎用 `details` にあった margin-top / border-top / padding-top が共通ヘッダーのメニューへ流出していた。`main details` / `main summary` に限定して本文の設定 UI を維持。

## 検証結果

| 検証 | 結果 |
| --- | --- |
| `npm test` | 64 tests / 64 pass |
| 既存メモ browser | CRUD、本文・メモ・タグ、予約カテゴリ、12テーマ/画面幅条件、409復旧 PASS |
| カテゴリ browser | メモ/ToDo × 320/390/1440px × light/dark/system-light/system-dark = 24条件 PASS |
| 共通ヘッダー browser | 10画面 × 6幅 × ログイン有無 = 120条件、それぞれlight/dark/print、OS追従、別タブ同期、メニュー位置・罫線 PASS |
| KDP browser | PC/スマホの作成・保存・出典・改稿案・復元・アーカイブ・export・未保存確認 PASS |
| Wiki browser | PC/スマホ × light/dark、OS切替、4.5文字コントラスト、フォルダ階層/移動、表/斜体/安全性、履歴/復元、409保持、関連ページ、認証復帰、長い名称、空検索 PASS |
| 独立レビュー | 指摘したページ選択状態・並べ替え後フォーカスを反映。最終差分の重大指摘なし |

カテゴリ検証には作成・改名・既存データのカテゴリ追従・順序変更・削除時の再割当・空状態・閉じる/完了/背景クリック/Escape・再開・長い名前・フォーカス制御・44px操作領域・横はみ出しを含む。

ヘッダー検証では、メモの全画面ログイン表示のみ合成環境で非表示にしてヘッダーの位置を独立検査。メモのログイン/データ表示は別の既存ブラウザテストとカテゴリテストで検査。

Wiki のコントラスト検証は可視要素数の固定閾値から、検索入力と開いているモーダルのタイトル・保存ボタンを明示的に検査する方式へ変更。空の通知欄を非表示にしても、各可視要素の 4.5 検査は維持。

## 画像比較

すべて合成データによるスクリーンショット。左は基準 main、右は変更後。元の個人データを含む添付画像はリポジトリへ保存していない。

- [メモ・スマホのカテゴリ管理](ui/memo-category-mobile.png)
- [ToDo・スマホ・ダークのカテゴリ管理](ui/todo-category-mobile-dark.png)
- [Wiki・PC](ui/wiki-desktop.png)
- [Wiki・スマホ・ダーク](ui/wiki-mobile-dark.png)
- [KDP ヘッダー](ui/kdp-header.png)

添付画像3件は子環境で Library の正規手順による取得に失敗。ヘルパーが返した正確なエラーは全件 `library file transfer failed: download failed`。HTTP status/拒否理由は表示されず、アクセス拒否と転送障害の区別はできなかった。親環境で取得・メタデータ適用・ピクセル確認に成功し、親から示されたメモ余白とKDPメニューの位置・罫線の症状に基づいて実装・再現比較した。

## 再実行

`worker` ディレクトリで実行。ブラウザは通常 Playwright の Chromium を使用する。OS の Chromium を使う場合だけ `BROWSER_EXECUTABLE` を指定。

```sh
npm ci
npx playwright install chromium
npm test
npm run test:wiki:browser
npm run test:header:browser
npm run test:kdp:browser
node test/memo-ui.browser.mjs
npx --yes --package tailwindcss@3.4.17 tailwindcss --content '../todo/index.html' --output /tmp/works-todo-ui.css --minify
TODO_FIXTURE_CSS=/tmp/works-todo-ui.css npm run test:category:browser
```

ToDo は本来 CDN の Tailwind を使うため、外部接続を遮断した合成ブラウザでは同じ HTML からコンパイルしたユーティリティを注入する。本番の CSS/CDN 読み込み方式は変更しない。比較元は `UI_ROOT`、画像出力先は `UI_ARTIFACTS`、基準画像のみ取得する場合は `UI_BASELINE=1` で切り替え可能。
