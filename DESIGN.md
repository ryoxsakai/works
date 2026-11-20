---
name: Works
version: 2026-11
theme: light-only
description: 授業・教材・業務をまとめた個人用ワークスペース。静かなグレーの地に白いカードを浮かべ、色は意味のある場所だけに使う。

colors:
  # 面（サーフェス）
  page: "#F4F5F7"            # ページの地。薄いグレー
  surface: "#FFFFFF"         # カード・ヘッダー・入力欄
  surface-sunken: "#F4F5F7"  # 白い面の中にさらに置く面（ToDoショートカット、目標欄など）
  sidebar: "#ECEEF1"         # サイドバー。ページよりひと段階濃い
  track: "#E8EAEE"           # 切り替えスイッチの溝・日付チップの地
  hover: "#ECEEF1"
  line: "#E3E5E9"            # 区切り線（カード内のみ）
  line-strong: "#D3D6DC"
  input-line: "#D5D8DE"      # 入力欄の枠
  # 文字（墨色の3段階）
  ink: "#1C1D21"             # 見出し・本文・選択中
  ink-2: "#4A4E57"           # ボタンの文字・補助本文
  ink-3: "#656A74"           # ラベル・日時・メタ情報（最小コントラスト4.5:1を確保する最も淡い色）
  # アクセント（青紫）
  accent: "#4D5BD8"
  accent-strong: "#3F4BC4"
  accent-soft: "#EEF0FF"
  gradient-start: "#3B82F6"
  gradient-mid: "#6D63F0"
  gradient-end: "#8B5CF6"
  # 状態チップ（地 / 文字）
  danger-bg: "#FDECEE"
  danger-fg: "#B4232F"
  info-bg: "#E8EFFF"
  info-fg: "#2F5BD0"
  success-bg: "#E4F5EC"
  success-fg: "#17784F"
  warning-bg: "#FFF2DC"
  warning-fg: "#94580A"

gradients:
  primary: "linear-gradient(135deg, {colors.gradient-start} 0%, {colors.gradient-mid} 55%, {colors.gradient-end} 100%)"

app-tints:                   # サイドバーのアプリアイコン（淡い地 / 線の色）
  home:      ["#EEF0FF", "#4D5BD8"]
  tutor:     ["#E8F0FF", "#2F6FE4"]
  material:  ["#EAF6FF", "#1F7FBF"]
  admission: ["#F2EDFF", "#7650E0"]
  workflow:  ["#FFF3E2", "#C26A00"]
  wiki:      ["#E9F7F1", "#1D8A5F"]
  todo:      ["#EAF1FF", "#3C64D8"]
  memo:      ["#FFF7DC", "#A77800"]
  kdp:       ["#FDECF3", "#C43C7A"]
  ss:        ["#EEF1F6", "#55607A"]

typography:
  family: "'M PLUS 2', 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', system-ui, sans-serif"
  weights: [300, 400, 500, 700, 800]
  root-size: 14px            # 1rem = 14px
  input-size-mobile: 16px    # スマホの入力欄は16px未満にしない
  scale:
    page-title:   { size: 20px, size-mobile: 18px, weight: 700, color: "{colors.ink}" }
    eyebrow:      { size: 0.7rem, weight: 700, letter-spacing: 0.12em, color: "{colors.ink-3}" }
    card-title:   { size: 1rem, weight: 700, color: "{colors.ink}" }
    body:         { size: 1rem, weight: 400, line-height: 1.6, color: "{colors.ink}" }
    label:        { size: 0.75rem, weight: 700, letter-spacing: 0.04em, color: "{colors.ink-3}" }
    caption:      { size: 0.82rem, weight: 400, color: "{colors.ink-3}" }

radius:
  sm: 6px      # 切り替えスイッチ内のボタン
  md: 8px      # カード・ボタン・入力欄（基本）
  pill: 999px  # チップ・クイック追加・下タブ

shadow:
  sm:  "0 0 0 1px rgb(16 18 24 / .03), 0 1px 2px rgb(16 18 24 / .07)"   # 選択中の面・小さなボタン
  md:  "0 1px 2px rgb(16 18 24 / .06), 0 4px 12px rgb(16 18 24 / .05)"  # カード
  lg:  "0 2px 6px rgb(16 18 24 / .08), 0 12px 32px rgb(16 18 24 / .12)" # ポップオーバー・ドロワー
  focus: "0 0 0 3px rgb(77 91 216 / .28)"

spacing:
  unit: 4px
  card-padding: 16px         # PCは16〜20px
  card-gap: 16px
  section-gap: 20px
  gutter: "clamp(16px, 2vw, 28px)"
  tutor-mobile-gutter: 1.5rem  # 授業カードのスライド位置がこの値に依存する。変えない

layout:
  header-height: 60px
  sidebar-width: 240px       # 1024px以上で常設
  content-width: full        # 本文は全幅
  breakpoints: { phone: 640px, desktop: 1024px, wide: 1200px }

components:
  header:
    backgroundColor: "{colors.surface}"
    height: "{layout.header-height}"
    position: sticky
  sidebar:
    backgroundColor: "{colors.sidebar}"
    item: { textColor: "{colors.ink-2}", radius: "{radius.md}" }
    item-selected: { backgroundColor: "{colors.surface}", shadow: "{shadow.sm}", textColor: "{colors.ink}", fontWeight: 700 }
  card:
    backgroundColor: "{colors.surface}"
    border: none
    radius: "{radius.md}"
    shadow: "{shadow.md}"
    padding: "{spacing.card-padding}"
  card-nested:               # 白いカードの中に置くカード（トップの授業カードなど）
    backgroundColor: "{colors.surface-sunken}"
    shadow: none
  button-primary:            # グラデーションはここだけ
    background: "{gradients.primary}"
    textColor: "#FFFFFF"
    radius: "{radius.pill}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    border: none
    shadow: "{shadow.sm}"
    textColor: "{colors.ink-2}"
    height: 36px
    radius: "{radius.md}"
  icon-button-ghost:         # カード内の補助操作（更新・絞り込みなど）
    backgroundColor: transparent
    textColor: "{colors.ink-3}"
    hoverBackground: "{colors.hover}"
  segmented-control:
    trackColor: "{colors.track}"
    item-selected: { backgroundColor: "{colors.surface}", shadow: "{shadow.sm}", textColor: "{colors.ink}" }
  input:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.input-line}"
    radius: "{radius.md}"
    focus: { borderColor: "{colors.accent}", shadow: "{shadow.focus}" }
  status-chip:
    radius: "{radius.pill}"
    fontSize: 0.82rem
    variants:
      danger:  { backgroundColor: "{colors.danger-bg}",  textColor: "{colors.danger-fg}" }   # 期限超過
      info:    { backgroundColor: "{colors.info-bg}",    textColor: "{colors.info-fg}" }     # 今日
      success: { backgroundColor: "{colors.success-bg}", textColor: "{colors.success-fg}" }  # 明日
      warning: { backgroundColor: "{colors.warning-bg}", textColor: "{colors.warning-fg}" }  # 持ち越し
      neutral: { backgroundColor: "{colors.track}",      textColor: "{colors.ink-2}" }       # それ以外
  tab-bar-mobile:            # 授業管理のスマホ下タブ
    shape: floating-pill
    backgroundColor: "{colors.surface}"
    shadow: "{shadow.lg}"
    labels: icon-only
    item-selected: { backgroundColor: "{colors.ink}", iconColor: "#FFFFFF" }
  date-chip:
    backgroundColor: "{colors.track}"
    textColor: "{colors.ink-2}"
    radius: "{radius.pill}"
  quick-add:
    extends: button-primary
    items: [ToDo, メモ]
  todo-list:
    desktop: "{components.card}"
    mobile: { layout: edge-to-edge, backgroundColor: "{colors.surface}", radius: 0, divider: "{colors.line}" }
  todo-page-add:             # ToDo見出し横の追加。主要ボタンはヘッダー側なので補助扱い
    extends: button-secondary
    textColor: "{colors.accent}"
  check:
    shape: circle
    size: 20px
    checkedColor: "{colors.accent}"
---

# Works デザインガイド

Works は、授業・教材・入試・ToDo・メモ・Wiki などをひとつにまとめた個人用の業務ツールです。毎日、長い時間、主にスマホで授業の合間に使います。デザインの目的は「目立つこと」ではなく、**今やるべきことが静かに、すぐ分かること**です。

この文書の上の層（YAML）は値、下の層（この本文）は「なぜその値か」です。書かれていない場面では、下の原則から判断してください。

## 1. 全体の方針

### 静かなグレーの地に、白いカードを浮かべる
ページの地は `page`（薄いグレー）、情報のまとまりは `surface`（白）のカードにします。地とカードの明度差だけで区切りが伝わるので、線や色に頼らずに済みます。逆（白地にグレーのカード）は平らで、まとまりが見えにくくなるため採用しませんでした。

### 枠線を使わず、2種類の影で区切る
カードは枠線なしで、`shadow.md` を使います。この影は、輪郭を出すごく近い影と、ふんわり浮かせる遠い影の2層です。線で囲むと画面が細かく分割されて硬く見えます。影なら、境界が自然に溶けながらもまとまりは保てます。

例外として、**入力欄には細い線を使います**（`input-line`）。「ここに書ける」ことは影より線のほうが確実に伝わるからです。カードの中の区切り（次回授業予定と生徒メモの間など）も、影を重ねられないので `line` の線にします。

### 色は意味のある場所だけに
- **グラデーションは主要ボタンだけ**（ヘッダーの「＋追加」など）。画面の中で一番押してほしい場所が、色だけで分かるようにするためです。ロゴ・選択中のタブ・選択中の日付・保存通知などには使いません。グラデーションが2か所以上あると、どれが主役か分からなくなります。
- **アクセントは青紫（`accent`）の単色**です。リンク、「＋ToDo」チップ、選択中の日付など、「押せる・今ここ」を示す小さな要素に使います。グラデーションと同じ系統の色なので、ブランドとして一貫して見えます。
- **アプリごとの淡い色**（`app-tints`）はサイドバーとクイック追加のアイコンにだけ使います。アプリを探すときの目印になるからです。本文の中には持ち込みません。
- **状態の色**（赤・青・緑・橙）は、期限や状態を表すチップだけに使います。

### 選択中は「白い面＋影」で浮かせる
サイドバー・ページ内タブ・一覧／カレンダーの切り替えなど、グレーの地の上にある選択肢は、選んだものを白い面と `shadow.sm` で浮かせます。色を塗るのではなく、物が一段手前に出てくる表現です。色で塗ると、アクセントの青紫が画面のあちこちに散ってしまうので避けました。

例外は**スマホの下タブ**です。白いバーの上では白い面が使えないので、選択中を墨色（`ink`）の丸い面にし、アイコンを白くします。色ではなく明暗で示すという考え方は同じです。

### ライトのみ
ダークモードはありません。画面の配色を1つに絞ることで、細部の品質をそろえられるからです。OSがダーク設定でも、ライトで表示します。`color-scheme: light` をすべての要素に強制しています。

## 2. 文字

- 書体は **M PLUS 2** に統一します。サービスごとに書体が違うと、別のアプリをつなぎ合わせたように見えるためです（以前はM PLUS 1p・Noto Sans JP・M PLUS Uが混在していました）。
- 基準は **14px**（`1rem`）の小さめの文字です。一画面の情報量を増やし、すっきり見せるためです。
- **スマホの入力欄だけは16px** にします。iPhoneは16px未満の入力欄に触れると画面を自動で拡大し、使いにくくなるためです。
- 見出しは控えめにします。**ページ見出しは20px（スマホ18px）**、カードの見出しは `1rem` の太字です。見出しが大きいと中身より目立つため、中身に目が行くようにしています。
- ページ見出しの上の英字（`eyebrow`：LESSON RECORDなど）はグレーの小さな大文字で、装飾ではなく「今どの画面か」の補助です。
- ラベル（「授業予定」「生徒メモ」など）は `label`（小さな太字・`ink-3`）にそろえます。ラベルと入力内容の差がはっきりしていると、どこに何を書くかが一目で分かります。
- 最も淡い文字色は `ink-3` です。これより淡いグレーを文字に使うと、白地でのコントラストが4.5:1を下回ります。補足の文字でも `ink-3` より淡くしないでください（入力欄のプレースホルダーを除く）。

## 3. 形と余白

- 角丸は **8px**（`radius.md`）が基本で、控えめにしています。丸すぎるとやわらかくなりすぎ、仕事道具としての引き締まった印象が薄れるためです。チップ・クイック追加・下タブだけは完全な丸（`pill`）です。小さく独立した要素であることを示すためです。
- 余白は**標準**（カードの内側・カード同士とも16〜20px）。ゆったりさせすぎると、授業カードを見比べにくくなります。
- 本文は**全幅**です。PCでは授業カードを2列以上に並べ、入力欄が横に間延びしないようにしています（1枚のカードの最小幅は約380px）。
- ボタンの高さは36〜40px。タップ領域は44px以上を保ちます（スマホで押し間違えないため）。

## 4. 画面ごとの考え方

### 共通ヘッダー・サイドバー
- ヘッダーは上部に固定し、全サービスで `shared/header.js` から同じものを組み立てます。1か所を直せば全ページに反映されるようにするためです。
- PC（1024px以上）は左にサイドバーを常設し、スマホは「≡」でヘッダーの下からドロワーを開きます。
- 右上は「＋追加」（ToDo・メモ）→ 設定 → アカウントの順です。

### トップページ
- 目的は「今日の授業と準備」です。あいさつは入れず、日付と見出しだけにしています。数字のまとめ（今日の授業数など）も置きません。すぐ授業カードが見えることを優先しています。
- PCでは「今日の授業」を広い左列、ToDoなどを右列に置きます。
- ウィジェット内の授業カードは、白いウィジェットの中に置かれるので `card-nested`（グレーの面・影なし）にします。白の上に白を重ねると区別できないためです。
- ToDo・SS案件の期限は**色付きチップ**で表示します（期限超過＝赤、今日＝青、明日＝緑、持ち越し＝橙、それ以外＝グレー）。急ぎ度を、文字を読む前に色で判断できるようにするためです。

### 授業管理（授業記録・授業予定・生徒情報）
- 3つのタブは**同じ見た目の規則**にそろえます。具体的には、見出しの大きさ・見出し部分の高さ・右側のボタン（36px・白・影）・カード・入力欄です。タブを切り替えたときに画面が揺れて見えないようにするためです。
- 見出しの横のボタンはすべて同じ形にします。役割が違っても形をそろえることで、「ここは操作の場所」と一目で分かります。
- 授業予定の、カレンダーごとの色（教室の色）は、カードの左の細い線（内側の影）で残します。どの教室の授業かという意味のある色だからです。
- スマホでは、タブを**浮いた角丸の下タブ**にします。親指が届きやすく、内容の上に軽く重ねられるからです。アイコンだけ表示し、文字は読み上げ用に残しています。
- スマホの左右の余白は1.5remで固定です。授業カードの横送りが、この値を前提に位置を合わせています。

### ToDo管理
- 一覧は、PCでは白いカード1枚にまとめ、行どうしはカード内の線で区切ります。
- **スマホでは端から端までの全幅リスト**にします（以前の改修で決めたもの。今回もこちらを選択）。文字を横いっぱいに使え、ネイティブアプリのリストに近い操作感になるためです。カード化の例外として扱います。
- 見出し横の「＋追加」は**補助ボタン**（白い面と影、文字は青紫）にします。ヘッダーの「＋追加」がグラデーションの主要ボタンなので、主要ボタンを1画面に1つに保つためです。追加シートの中では「追加する」が唯一の操作なので、ここだけグラデーションにします。
- 締切はトップと同じ色付きチップです（期限超過＝赤、今日＝青、明日＝緑、それ以外＝グレー）。役割（生徒管理など）・プロジェクト・作業日はグレーのチップにして、色は急ぎ度だけに使います。
- チェックは丸に統一します（以前はスマホだけ四角でした）。
- 左の2列目のメニュー（今日・インボックスなど）も、サイドバーと同じ「グレーの地に、選択中は白い面と影」です。
- スマホの下メニューは授業管理と同じ浮いた角丸バーで、アイコンだけを表示します。追加ボタンは淡い青紫の丸にして、主要ボタンと区別します。
- 文字の太さは、補足400、ラベル・ボタン・タスク名600、見出し700の3段階です。
- タスク名の入力欄は16px以上を保ちます（iPhoneの自動拡大を防ぐため）。

## 5. 新しい部品を作るときの判断基準

1. まずトークンを名前で参照します。値を直接書くのは、トークンにない例外のときだけです。
2. 区切りが必要なら、まず「白い面と影」で表せないか考えます。線は入力欄とカード内の区切りだけにします。
3. 色を足したくなったら、それが「押してほしい場所」か「状態」かを考えます。どちらでもなければ墨色とグレーで表します。
4. 主要ボタンは1画面に1つまでにします。2つ以上あるなら、1つ以外は `button-secondary` にします。
5. 選択中は、グレーの地なら白い面と影、白い地なら墨色の面にします。
6. 文字の色は `ink` / `ink-2` / `ink-3` の3段階から選びます。新しいグレーを作らないでください。

## 6. 採用しなかったもの（と理由）

| 案 | 採用しなかった理由 |
|---|---|
| ページ全体のグラデーション背景 | 文字が読みにくく、ぼやけた印象になる |
| ダークモード | 配色を1つに絞って品質をそろえるため |
| 大きなあいさつ（例：「おはようございます」） | 授業カードを早く見せることを優先 |
| 数字のまとめカード（KPI） | 同上。スマホで授業カードが下に押し出される |
| カード上部の色帯（時刻・記録状態） | 情報が増え、カードが重くなる |
| 選択中を淡い青で塗る | アクセント色が画面に散らばる |
| 本文を中央に寄せて幅を絞る | 授業カードを多く並べたい |
| グラデーションの枠だけのボタン | 主要ボタンは塗りのほうが押す場所として明確 |

## 7. 実装の場所

| ファイル | 役割 |
|---|---|
| `shared/works-design.css` | トークン（CSS変数）。全ページで読み込み、既存の `--bg` `--fg` などの変数もここで新しい値に置き換えている |
| `shared/header.css` / `shared/header.js` | 共通ヘッダー・サイドバー・ドロワー・クイック追加 |
| `shared/lesson-ui.css` | 授業カード（トップと授業管理で共用）と授業管理の3タブ |
| `home-v2.css` | トップページのレイアウト・ウィジェット・状態チップ |
| `todo/todo-v2.css` | ToDo管理の見た目（一覧カード、締切チップ、追加シート、下メニュー） |

CSSを変更したら、読み込み側の `?v=` を上げてください（ブラウザのキャッシュを確実に更新するため）。
