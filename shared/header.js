import { getTheme, setTheme } from "./theme.js?v=6";

const header = document.querySelector(".works-header");
const actions = header?.querySelector(".works-header-actions");
if (actions) {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--works-header-height", `${header.getBoundingClientRect().height}px`);
  }).observe(header);
  const navigation = document.createElement("details");
  navigation.className = "works-navigation";
  navigation.innerHTML = `<summary aria-label="サービス一覧"><svg class="works-menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span class="works-menu-label">メニュー</span><span class="works-menu-label" aria-hidden="true">▾</span></summary>
    <nav aria-label="Works サービス"><a href="/">ホーム</a>
    <span>授業・教材</span><a href="/tutor/">授業管理</a><a href="/material/">教材管理</a><a href="/admission/">入試管理</a>
    <span>自動実行</span><a href="/workflow/">ワークフロー</a><a href="/wiki/">Wiki</a>
    <span>業務</span><a href="/todo/">ToDo管理</a><a href="/memo/">メモ</a>
    <span>制作</span><a href="/kdp/">KDP管理</a><a href="/ss/">SS管理</a></nav>`;
  const homeLink = header.querySelector(".works-home");
  navigation.querySelectorAll("a").forEach((link) => {
    if (link.pathname === location.pathname) link.setAttribute("aria-current", "page");
    // Reuse page-specific unsaved-change guards (Wiki/KDP) for every destination.
    link.addEventListener("click", (event) => {
      if (typeof homeLink.onclick === "function") homeLink.onclick(event);
    });
  });
  document.addEventListener("click", (event) => {
    if (!navigation.contains(event.target)) navigation.open = false;
  });
  navigation.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      navigation.open = false;
      navigation.querySelector("summary").focus();
    }
  });
  actions.prepend(navigation);

  // Home and Tutor already own a settings dialog. Other services use this
  // shared dialog, with the same theme module and storage key on every page.
  if (!header.querySelector("#open-settings, #open-home-settings")) {
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "works-settings-toggle";
    settings.setAttribute("aria-label", "設定");
    settings.title = "設定";
    settings.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-.6 2-2 .9-1.9-.5L2 9.5 3.5 11v2L2 14.5l2.5 4.1 1.9-.5 2 .9.6 2h6l.6-2 2-.9 1.9.5 2.5-4.1L20.5 13v-2L22 9.5l-2.5-4.1-1.9.5-2-.9L15 3Z"/><circle cx="12" cy="12" r="3"/></svg>`;
    const dialog = document.createElement("dialog");
    dialog.className = "works-settings-dialog";
    dialog.setAttribute("aria-labelledby", "works-settings-title");
    dialog.innerHTML = `<div class="works-settings-heading"><h2 id="works-settings-title">設定</h2><button type="button" aria-label="閉じる">×</button></div>
      <fieldset><legend>表示テーマ</legend>
      <label><input type="radio" name="works-theme" value="system"> OS設定に合わせる</label>
      <label><input type="radio" name="works-theme" value="light"> ライト</label>
      <label><input type="radio" name="works-theme" value="dark"> ダーク</label></fieldset>
      <p>このブラウザのWorks全サービスに適用します。</p>`;
    document.body.append(dialog);
    settings.addEventListener("click", () => { navigation.open = false; syncTheme(); dialog.showModal(); });
    dialog.querySelector("button").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => settings.focus());
    dialog.addEventListener("change", (event) => {
      if (event.target.matches('input[name="works-theme"]:checked')) setTheme(event.target.value);
    });
    navigation.after(settings);
  }
  function syncTheme() {
    document.querySelectorAll('input[name="theme"], input[name="home-theme"], input[name="works-theme"]').forEach((radio) => {
      radio.checked = radio.value === getTheme();
    });
  }
  window.addEventListener("works-theme-change", syncTheme);
  syncTheme();
}
