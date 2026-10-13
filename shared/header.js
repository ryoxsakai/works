import { getTheme, setTheme } from "./theme.js?v=6";

const header = document.querySelector(".works-header");
const actions = header?.querySelector(".works-header-actions");
if (actions) {
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--works-header-height", `${header.getBoundingClientRect().height}px`);
  }).observe(header);
  const navigation = document.createElement("details");
  navigation.className = "works-navigation";
  navigation.innerHTML = `<summary aria-label="サービス一覧">メニュー <span aria-hidden="true">▾</span></summary>
    <nav aria-label="Works サービス"><a href="/">ホーム</a>
    <span>授業・教材</span><a href="/tutor/">授業管理</a><a href="/material/">教材管理</a><a href="/admission/">入試管理</a>
    <span>業務</span><a href="/wiki/">Wiki</a><a href="/todo/">ToDo管理</a>
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
  const label = document.createElement("label");
  label.className = "works-theme-control";
  label.innerHTML = `<span class="works-sr-only">表示テーマ</span><select aria-label="表示テーマ">
    <option value="system">OS設定</option><option value="light">ライト</option><option value="dark">ダーク</option></select>`;
  const select = label.querySelector("select");
  select.value = getTheme();
  select.addEventListener("change", () => setTheme(select.value));
  window.addEventListener("works-theme-change", () => { select.value = getTheme(); });
  actions.prepend(navigation, label);
}
