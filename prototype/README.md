# Works 共通アプリ枠・SS試作（第1段階）

基準main: `ff16f566c829485cdbca049c2d2dd7dad3808fb3`。
この文書は合成データ試作の仕様です。続く実利用向けの独立入口 `/app/` と認証・実SS読取APIの接続は [第1段階の実装説明](../docs/app-shell-stage1.md) を参照してください。`/prototype/` はローカル開発用の合成試作のままです。既定ホーム、旧SS、API、DB、承認・実行権は切り替えません。マージ・本番反映は親の確認前に行いません。

## 起動と操作

```sh
cd /workspace/works/prototype
npm ci --ignore-scripts --cache /tmp/works-prototype-npm-cache
npm run dev
```

ローカル: <http://127.0.0.1:4173/prototype/#!/home/>
SS詳細: <http://127.0.0.1:4173/prototype/#!/ss/ss-101/>
合成データのみ。試作メモの保存先はメモリ内で、タブの再読み込みで消える。実際のSSへの保存機能は追加していない。サンプルの進捗率も試作表示で、現在のSS APIにその項目があるとは扱わない。
未移行機能は分類画面に「未統合」と表示し、既存Worksを別タブで開く。自動テストは外部アクセスを遮断し、既存Worksは操作しない。

## 画面構成

| 画面 | iPhone相当 | PC |
|---|---|---|
| 共通ナビ | ホーム／授業／業務／ワークフロー／その他の下部5項目 | 同じ分類を常設左パネル |
| ホーム | 今日の入口、SSへの導線、2列の分類カード | 大きな導入カード＋4列の分類 |
| SS | 案件一覧→案件詳細、一覧へ戻る | 一覧と詳細の2ペイン |
| 未移行機能 | 未統合の説明＋従来画面へのリンク | 同左 |

320／390／768／1440pxで確認。CSSのsafe-area（上・左右・下）とviewport-fitを使用。ソフトキーボード時は下部ナビを隠し、編集欄が可視範囲へ入る。実際のiPhoneのキーボード検証は後述の未確認事項。

## Framework7 Coreの適合評価

採用試験: **Framework7 Core 9.2.0、MIT、正規npmレジストリ**。React／Lit／別ルーターは追加していない。Vite 8.3.5は開発・静的ビルド用。バージョンと取得先は独立したpackage-lockで固定し、既存worker/package.jsonやロックは変更しない。インストールはignore-scripts付き。課金・契約・新しい資格情報は不要。

- CoreのRouter＋Panelだけを利用。plain JSの既存DOMにmount可能。PCのvisibleBreakpoint、スマホの固定toolbarを評価した。
- Router標準のbeforeLeaveだけでは、ブラウザBackをキャンセルした時に表示とURLがずれることを実測。また、同じHome URLへの再訪後、標準pop処理がForwardをBackと判定するケースを再現した。
- `navigation-guard.mjs`が履歴に位置番号を付け、未保存キャンセル時は元の位置へ戻す。受け入れた移動先は同じFramework7の公開router.navigateへ渡す。第二のルーターやライブラリ内部の変更は行わない。この補正は単一View・swipe-back無効の今回の構成に限定し、将来の複数View・スワイプ操作へ一般化したとは扱わない。
- マウントにはpageAfterInを使う。reloadAllではrouteChangedが発火しない経路があるため、routeChangedだけに依存しない。
- App外の共通toolbarは、F7標準のpage内toolbarの配置／z-indexをそのまま使うと画面外・操作不可になるため、固定位置とレイヤーを明示。実際に画面内でクリックできることをテストした。

結論: **この試作範囲では実装可能**。下部ナビ・PCパネル・画面遷移の体験には合う。履歴補正と既存CSSの分離が必要なので「入れるだけで統合完了」ではない。Litの方が軽量・部品境界を明示しやすい可能性はあるが、本試作では比較実装せず積み重ねていない。次段階へ進む前にiPhone実機で履歴とキーボードの適合を確認する。

公式資料:
- https://framework7.io/docs/app
- https://framework7.io/docs/routes
- https://framework7.io/docs/view
- https://framework7.io/docs/panel

## 分離の方式

- `app.mjs`: 共通枠、Framework7ルート、未移行機能の入口。
- `ss-module.mjs`: root限定のDOM、AbortController付きイベント、`canLeave/unmount`。終了後の遅延読み込みを破棄する。
- `session.mjs`: session初期化をPromiseで合流。既定は合成セッション。実際のshared/auth.jsも、ブラウザテストで合成トークン／Google応答を注入して接続確認する。ブラウザの実セッション・実アカウントは使わない。
- `ss-model.mjs`: 現行SSのステータス順・完了非表示・締切日順を踏襲。現行ss/app.jsを直接importして重複起動しない。
- 保存は試作メモのみ。連打／同じrequestIdの再送は1回。画面往復・再マウントによる保存は0回。
- CSSは試験入口だけで読み込む。既存グローバルCSSを混ぜない。印刷はSS詳細だけをA4に出し、共通ナビを除く。

## 検証

既存の `worker/node_modules/@playwright/test` を使う（worker側の依存変更なし）。ブラウザが必要なら環境の既存Chromiumを指定する。

```sh
npm test
BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser
npm run build
```

- Unit 4件: auth同時初期化、メモの冪等保存、読込中断／失敗／空、SSのソート・完了・エスケープ。
- Browser: URL／直リンク／再読み込み、Back／Forward、両方向の未保存キャンセル、未保存リロード拒否、20往復のmount/unmount対応、初期化1回、連打でも保存1回、画面往復で保存増加なし、外部／APIリクエスト0、分類と未移行リンク、スマホ／PC、空／失敗／中断後の遅延応答を確認。
- Auth browser: 実際のshared/auth.jsを利用し、合成セッション・合成Google応答に限って初期化／token取得／userinfo各1回を確認。外部実通信は遮断。
- モバイル下部ナビの画面内位置・クリック、キーボードによるvisualViewport縮小の決定的シミュレーション、編集欄の可視範囲、ナビ復帰、キーボード操作。
- Print: ナビ非表示・詳細表示、PDFはA4・1ページ。
- Build: Core＋Panelを含むJS 288.28KB／gzip 81.91KB、CSS 157.17KB／gzip 26.81KB（最終ビルド値を参照）。全機能を一度に読む構成ではないが、さらにコード分割・性能比較する余地はある。

成果物はgitignore対象の `test-artifacts/`。`desktop-home.png`、`desktop-ss.png`、`mobile-home-390.png`、`mobile-ss-list-390.png`、`mobile-ss-detail-390.png`、`mobile-keyboard-simulation.png`、`ss-print.pdf`。320px／768pxの画面も同じフォルダ。

## 未確認・次の判断

- iPhone実機Safariのsafe area、実キーボード、スワイプ、ホーム画面追加でのGoogle認証。本物のOAuth・本番SS APIはまだ接続していない。
- 既存の保存中・401／409・複雑な承認モーダルの統合は次段階。今回それらの既存実装を置き換えていない。
- SSの進捗率や試作メモを正式機能にするかは別途判断。試作を本番SSの編集機能と誤認させない。
- 現行ルートは一切切替なし。廃棄・ロールバックはprototype入口と試作ディレクトリを採用しないだけでよい。DB復元は不要。

親による画面確認の後、実機での適合を確認し、SS読取APIの認証済み接続に進むかを判断する。既定トップの切替や全面移行を自動的に進めない。
