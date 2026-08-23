import { getSessionToken, signIn, watchAuth } from "../shared/auth.js?v=11";

const VIEW_KEY = "works_admission_view";
const stageLabels = {
  primary: "一次試験",
  first_result: "一次発表",
  secondary: "二次試験",
  final_result: "合格発表",
};
const typeLabels = {
  general: "一般選抜",
  ct: "共通テスト利用",
  recommendation: "推薦",
  regional: "地域枠",
  comprehensive: "総合型選抜",
};

const els = {
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  signIn: document.querySelector("#sign-in"),
  authError: document.querySelector("#auth-error"),
  error: document.querySelector("#admission-error"),
  tabs: [...document.querySelectorAll("[data-admission-view-tab]")],
  views: [...document.querySelectorAll("[data-admission-view]")],
  list: document.querySelector("#admission-list"),
  table: document.querySelector("#admission-table-body"),
  add: document.querySelector("#admission-add"),
  editor: document.querySelector("#admission-editor"),
  editorClose: document.querySelector("#admission-editor-close"),
  form: document.querySelector("#admission-form"),
};

let events = [];

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
}

function showError(error) {
  els.error.textContent = error instanceof Error ? error.message : String(error || "");
}

async function api(path, options = {}) {
  const token = getSessionToken();
  if (!token) throw new Error("ログイン情報が見つかりません");
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "入試日程の保存に失敗しました");
  return data;
}

function activateView(name) {
  const active = els.tabs.some((tab) => tab.dataset.admissionViewTab === name) ? name : "list";
  els.tabs.forEach((tab) => {
    const selected = tab.dataset.admissionViewTab === active;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  els.views.forEach((view) => { view.hidden = view.dataset.admissionView !== active; });
  localStorage.setItem(VIEW_KEY, active);
}

function renderList() {
  if (!events.length) {
    els.list.innerHTML = `<div class="admission-empty-state"><div><i class="bx bx-list-ul"></i><p>入試日程はまだ登録されていません</p><small>右上の「日程を追加」から、大学・方式・段階・日付を登録できます。</small></div></div>`;
    return;
  }
  els.list.innerHTML = events.map((event) => `
    <article class="admission-list-item admission-stage-${escapeHtml(event.stage)}">
      <time datetime="${escapeHtml(event.schedule_date)}">${escapeHtml(formatDate(event.schedule_date))}</time>
      <div class="admission-list-copy">
        <strong>${escapeHtml(event.university)}</strong>
        <span>${escapeHtml(typeLabels[event.selection_type] || event.selection_type)} ・ ${escapeHtml(stageLabels[event.stage] || event.stage)}</span>
        ${event.notes ? `<small>${escapeHtml(event.notes)}</small>` : ""}
      </div>
      <span class="admission-stage-badge">${escapeHtml(stageLabels[event.stage] || event.stage)}</span>
    </article>`).join("");
}

function renderTable() {
  if (!events.length) {
    els.table.innerHTML = `<tr class="admission-table-empty"><td colspan="5">入試日程はまだ登録されていません。</td></tr>`;
    return;
  }
  els.table.innerHTML = events.map((event) => `
    <tr>
      <td><strong>${escapeHtml(event.university)}</strong></td>
      <td>${escapeHtml(typeLabels[event.selection_type] || event.selection_type)}</td>
      <td>${escapeHtml(stageLabels[event.stage] || event.stage)}</td>
      <td>${escapeHtml(formatDate(event.schedule_date))}</td>
      <td>${escapeHtml(event.notes || "—")}</td>
    </tr>`).join("");
}

function render() {
  renderList();
  renderTable();
}

async function loadEvents() {
  showError("");
  events = await api("/admissions");
  render();
}

function openEditor() {
  els.form.reset();
  els.form.schedule_date.value = new Date().toISOString().slice(0, 10);
  els.editor.showModal();
}

els.signIn.addEventListener("click", signIn);
els.add.addEventListener("click", openEditor);
els.editorClose.addEventListener("click", () => els.editor.close());
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateView(tab.dataset.admissionViewTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = els.tabs.indexOf(tab);
    const next = event.key === "ArrowRight"
      ? (index + 1) % els.tabs.length
      : (index - 1 + els.tabs.length) % els.tabs.length;
    els.tabs[next].focus();
    activateView(els.tabs[next].dataset.admissionViewTab);
  });
});
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.form);
  const body = Object.fromEntries(form.entries());
  try {
    await api("/admissions", { method: "POST", body: JSON.stringify(body) });
    els.editor.close();
    await loadEvents();
  } catch (error) {
    showError(error);
  }
});

activateView(localStorage.getItem(VIEW_KEY) || "list");
watchAuth({
  onSignedIn: async () => {
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;
    try {
      await loadEvents();
    } catch (error) {
      showError(error);
    }
  },
  onSignedOut: (message) => {
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    els.authError.textContent = message || "";
  },
});
