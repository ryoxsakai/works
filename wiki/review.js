import { esc } from "./markdown.js?v=2";
const $ = (id) => document.getElementById(id);
const names = ["content", "proposals", "history"];
export function selectPanel(name) {
  for (const key of names) {
    const selected = key === name;
    $("tab-" + key).setAttribute("aria-selected", String(selected));
    $("tab-" + key).tabIndex = selected ? 0 : -1;
    $("panel-" + key).hidden = !selected;
  }
}
for (const [index, name] of names.entries()) {
  $("tab-" + name).onclick = () => selectPanel(name);
  $("tab-" + name).onkeydown = (event) => {
    const offset = {
      ArrowRight: 1,
      ArrowLeft: -1,
      Home: -index,
      End: 2 - index,
    }[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = names[(index + offset + names.length) % names.length];
    selectPanel(next);
    $("tab-" + next).focus();
  };
}
let returnFocus;
export function closeReview() {
  if (!$("review-dialog").open) return;
  $("review-dialog").close();
  const target =
    returnFocus?.isConnected && !returnFocus.disabled
      ? returnFocus
      : $("tab-proposals");
  target.focus();
}
$("review-close").onclick = $("review-done").onclick = closeReview;
$("review-dialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeReview();
});
const status = (s) => (s === "confirmed" ? "確認済み" : "下書き");
function metadata(c, folderLabel) {
  return `<dl class="wiki-change-meta"><dt>確認状態</dt><dd>${status(c.status)}</dd><dt>フォルダ</dt><dd>${esc(folderLabel(c.folder_id ?? null) || "不明なフォルダ")}${c.folder_id ? ` （ID: ${esc(c.folder_id)}）` : ""}</dd><dt>アーカイブ状態</dt><dd>${c.archived ? "アーカイブ済み" : "通常表示（未アーカイブ）"}</dd>${[
    ["タグ", c.tags],
    ["別名", c.aliases],
    ["関連ページID", c.links],
  ]
    .map(
      ([name, values]) =>
        `<dt>${name}</dt><dd>${esc((values || []).join("、") || "なし")}</dd>`,
    )
    .join(
      "",
    )}<dt>出典</dt><dd>${(c.sources || []).map((s) => `<p>${esc(s.type)} · ${esc(s.id || s.url)}<br>${esc(s.location)} · 確認日 ${esc(s.checked_at)}${s.id && s.url ? `<br>${esc(s.url)}` : ""}</p>`).join("") || "なし"}</dd></dl>`;
}
export function compare(
  a,
  b,
  label,
  proposalId = null,
  folderLabel = (id) => id || "未分類",
) {
  const oldLines = a.body.split("\n"),
    newLines = b.body.split("\n");
  $("review-title").textContent = label;
  $("review-message").textContent = "";
  $("comparison").innerHTML = `<div class="diff">${[
    [a, oldLines, newLines, "変更前", "removed", "−"],
    [b, newLines, oldLines, "変更後", "added", "+"],
  ]
    .map(
      ([c, lines, other, heading, cls, marker]) =>
        `<section><h3>${heading}</h3><h4>${esc(c.title)}</h4>${lines.map((line, i) => `<pre class="${line === other[i] ? "" : cls}"><span>${line === other[i] ? " " : marker} </span>${esc(line) || " "}</pre>`).join("")}<h4>出典・ページ情報</h4>${metadata(c, folderLabel)}</section>`,
    )
    .join("")}</div>`;
  $("review-adopt").hidden = !proposalId;
  if (proposalId) $("review-adopt").dataset.acceptReviewed = proposalId;
  else delete $("review-adopt").dataset.acceptReviewed;
  if (!$("review-dialog").open) {
    returnFocus = document.activeElement;
    $("review-dialog").showModal();
  }
  $("review-close").focus();
}
