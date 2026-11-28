import {colorValue, isHexColor} from "./model.mjs?v=color-picker-1";
import {createPlanner} from "./planner-ui.mjs?v=gtasks-1";
import { startTodoPresentation } from "../shared/ui/todo-presentation.mjs?v=2";
startTodoPresentation();
import {
  watchAuth,
  signIn,
  signOutUser,
  getSessionToken,
} from "../shared/auth.js?v=15";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function resizeCaptureSheet() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
  $("capture-sheet").style.setProperty("--keyboard-inset", inset + "px");
}
window.visualViewport?.addEventListener("resize", resizeCaptureSheet);
window.visualViewport?.addEventListener("scroll", resizeCaptureSheet);
const statusNames = {
  pending: "未着手",
  doing: "進行中",
  waiting: "待ち",
  done: "完了",
};
const statusOf = (t) =>
  t.status ??
  (t.progress === 100 ? "done" : t.progress > 0 ? "doing" : "pending");
const today = () =>
  new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const offset = (date, days) =>
  new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
const pendingKey = "works-todo-clone-requests-v1";
let state,
  plannerReady = false,
  busy = false,
  mode = "list",
  editId,
  checklist = [],
  cloneSource,
  cloneBase,
  dialogEpoch = 0;
let pendingFocusRestore = null;
const pendingPrefix = pendingKey + ":";
function validPending(args) {
  return (
    args &&
    typeof args.id === "string" &&
    typeof args.request_id === "string" &&
    /^[a-zA-Z0-9_-]{16,100}$/.test(args.request_id) &&
    typeof args.base_day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(args.base_day) &&
    Number.isInteger(args.offset_days) &&
    args.offset_days >= 1 &&
    args.offset_days <= 3650
  );
}
function readPending() {
  const result = {};
  try {
    // Migrate the original map to independent keys without erasing other tabs.
    const legacy = JSON.parse(localStorage.getItem(pendingKey) || "{}");
    for (const args of Object.values(legacy || {}))
      if (validPending(args))
        localStorage.setItem(
          pendingPrefix + args.request_id,
          JSON.stringify(args),
        );
    localStorage.removeItem(pendingKey);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(pendingPrefix)) continue;
      try {
        const args = JSON.parse(localStorage.getItem(key));
        if (validPending(args) && key === pendingPrefix + args.request_id)
          result[args.request_id] = args;
      } catch {}
    }
  } catch {}
  return result;
}
let pending = readPending();
window.addEventListener("storage", (event) => {
  if (event.key === pendingKey || event.key?.startsWith(pendingPrefix)) {
    pending = readPending();
    if (state) renderRecovery();
  }
});
async function api(path = "", options = {}) {
  const response = await fetch("/api/todo" + path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getSessionToken()}`,
    },
  });
  const body = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(body.error || `HTTP ${response.status}`), {
      status: response.status,
    });
  return body;
}
document.addEventListener("click", event => {
  for (const menu of document.querySelectorAll(".row-menu[open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    const menu = document.querySelector(".row-menu[open]");
    if (menu && !document.querySelector("dialog[open]")) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  }
});
let noticeTimer;
function message(text, temporary = false) {
  clearTimeout(noticeTimer);
  $("notice").textContent = text;
  if (temporary) noticeTimer = setTimeout(() => { $("notice").textContent = ""; }, 5000);
}
function setBusy(value) {
  busy = value;
  document
    .querySelectorAll(
      "#app button,#app input,#app select,.todo-page dialog button:not([data-close]),.todo-page dialog input,.todo-page dialog select,.todo-page dialog textarea",
    )
    .forEach((el) => {
      const stale = el.closest("dialog")?.dataset.stale === "true";
      el.disabled =
        value ||
        el.hasAttribute("data-fixed-disabled") ||
        (el.id === "capture-submit" && !$("quick-title").value.trim()) ||
        (stale && !el.hasAttribute("data-dialog-reload"));
    });
  if (!value && pendingFocusRestore) {
    const pending = pendingFocusRestore;
    pendingFocusRestore = null;
    if (
      pending.epoch === dialogEpoch &&
      !document.querySelector("dialog[open]")
    )
      restoreDialogFocus(pending.target);
  }
}
async function reload() {
  const loaded = await api();
  plannerReady = loaded.plannerVersion === 1;
  state = loaded;
  render();
  if (!plannerReady) message("新しいToDoサーバーの反映後に編集できます。今は一覧を表示しています。");
}
async function save(next, success = "保存しました") {
  if (busy) return false;
  if (!plannerReady) {message("新しいToDoサーバーの反映後に保存できます。"); return false;}
  const focusOrigin = document.activeElement;
  const dialog = document.querySelector(".todo-page dialog[open]"),
    epoch = dialogEpoch;
  // Every form stays bound to the revision it originally displayed.
  if (dialog) next.revision = Number(dialog.dataset.baseRevision);
  setBusy(true);
  try {
    const result = await api("", { method: "PUT", body: JSON.stringify(next) });
    if (next.planner && !result.planner) throw new Error("サーバーの更新が必要です");
    state = result;
    render();
    if (dialog?.open && epoch === dialogEpoch)
      dialog.dataset.baseRevision = String(state.revision);
    message(success, true);
    return true;
  } catch (error) {
    message(
      error.status === 409
        ? "別の更新があります。再読み込みしました。内容を確認して再操作してください。"
        : "保存結果を確認できません。再読み込みして内容を確認してください。",
    );
    try {
      await reload();
    } catch {}
    if (
      dialog?.open &&
      epoch === dialogEpoch &&
      (error.status === 409 ||
        !error.status ||
        Number(dialog.dataset.baseRevision) !== state.revision)
    ) {
      dialog.dataset.stale = "true";
      dialog.querySelector("[data-dialog-conflict]").hidden = false;
    }
    return false;
  } finally {
    setBusy(false);
    const modal = focusOrigin?.closest("dialog");
    if (
      focusOrigin?.isConnected &&
      (!modal || modal.open) &&
      document.activeElement === document.body
    )
      focusOrigin.focus();
  }
}
function roleBadgeAttrs(color) {
  return isHexColor(color)
    ? `class="badge role-custom" style="--role-color:${colorValue(color)}"`
    : `class="badge role-${esc(color)}"`;
}
function roleBadge(t) {
  const r = state.roles.find((r) => r.id === t.roleId);
  return r
    ? `<span ${roleBadgeAttrs(r.color)}>${esc(r.icon)} ${esc(r.name)}${r.archived ? "（保管）" : ""}</span>`
    : "";
}
// Deadline chip tone, matching the Home widget (DESIGN.md: status-chip).
function dueTone(deadline, base, done) {
  if (done) return "due-neutral";
  const next = new Date(base + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  if (deadline < base) return "due-danger";
  if (deadline === base) return "due-info";
  if (deadline === next.toISOString().slice(0, 10)) return "due-success";
  return "due-neutral";
}
function card(t, groupDay) {
  const done = statusOf(t) === "done",
    base = today();
  const manual = $("task-sort").value === "manual";
  return `<article class="task-card planner-row" data-task="${esc(t.id)}">
    ${manual ? '<span class="drag-grip" aria-hidden="true" title="ドラッグして移動">⠿</span>' : ""}
    <button class="done-toggle" data-action="complete" aria-pressed="${done}" aria-label="${done ? "未着手に戻す" : "完了にする"}：${esc(t.name)}">${done ? "✓" : "○"}</button>
    <div class="task-body"><button class="task-name" data-action="detail" aria-label="詳細：${esc(t.name)}">${t.important ? "★ " : ""}${esc(t.name)}</button>
    <div class="task-meta">${planner.meta(t)}${roleBadge(t)}
    ${t.plannedDay && t.plannedDay !== groupDay ? `<small>作業日 ${esc(t.plannedDay)}</small>` : ""}${t.deadline ? `<small class="due-chip ${dueTone(t.deadline, base, done)}${t.deadline < base && !done ? " overdue" : ""}">${t.deadline < base && !done ? "期限超過 · " : ""}締切 ${esc(t.deadline)}</small>` : ""}
    ${statusOf(t)!=="pending" ? `<small>${statusNames[statusOf(t)]}</small>` : ""}
    ${t.checklist?.length ? `<small>☑ ${t.checklist.filter(c=>c.checked).length}/${t.checklist.length}</small>` : ""}</div></div>
    <details class="row-menu"><summary aria-label="${esc(t.name)}の操作">•••</summary><div>
    <button data-action="plan-today">今日に予定</button><button data-action="tomorrow">明日に予定</button>
    ${manual ? '<button data-action="up">↑ 上へ</button><button data-action="down">↓ 下へ</button>' : ""}
    ${[1,3,7,14].map(n=>`<button data-action="clone" data-days="${n}" aria-label="${n===7?"1週間後":n===14?"2週間後":n+"日後"}に複製：${esc(t.name)}">${n}日後に複製</button>`).join("")}
    <button data-action="custom-clone">日付を選んで複製</button></div></details></article>`;
}
function group(title,tasks,date,groupDay = date) {
  return `<section class="group${date && !tasks.length ? " is-empty" : ""}"${date ? ` id="agenda-${esc(date)}"` : ""}>${title ? `<div class="group-heading"><h3>${esc(title)}</h3>${date ? `<button data-add-day="${esc(date)}" aria-label="${esc(title)}にタスクを追加">＋</button>` : `<span>${tasks.length}</span>`}</div>` : ""}<div class="task-rows">${tasks.map(t => card(t, groupDay)).join("")}</div>${date && !tasks.length ? '<p class="agenda-empty">予定なし</p>' : ""}</section>`;
}
function render() {
  let role = $("role-filter").value,
    category = $("category-filter").value;
  $("role-filter").innerHTML =
    '<option value="">すべて</option>' +
    state.roles
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.icon)} ${esc(r.name)}${r.archived ? "（保管）" : ""}</option>`,
      )
      .join("");
  $("role-filter").value = state.roles.some((r) => r.id === role) ? role : "";
  $("category-filter").innerHTML =
    '<option value="">すべて</option>' +
    state.categories.map((c) => `<option>${esc(c)}</option>`).join("");
  $("category-filter").value = state.categories.includes(category)
    ? category
    : "";
  role = $("role-filter").value;
  category = $("category-filter").value;
  const list = state.tasks.filter(
      (t) =>
        (!role || t.roleId === role) && (!category || t.category === category) &&
        (!$("task-search").value.trim() || [t.name, t.memo, t.reusableDescription].join(" ").toLocaleLowerCase().includes($("task-search").value.trim().toLocaleLowerCase())),
    ),
    base = today();
  const filtered = !!(role || category || $("task-search").value.trim());
  $("clear-filters").hidden = !filtered;
  $("task-count").textContent = `${list.length}件表示 / 全${state.tasks.length}件${filtered ? " · 絞り込み中（締切の確認は全件）" : ""}`;

  // Deadline guardrail deliberately ignores role/category filters.
  const due = state.tasks
    .filter(
      (t) =>
        statusOf(t) !== "done" && t.deadline && t.deadline <= offset(base, 7),
    )
    .sort((a, b) => a.deadline.localeCompare(b.deadline));
  $("deadlines").innerHTML = due.length
    ? due
        .map(
          (t) =>
            `<div class="deadline-row"><button data-deadline="${esc(t.id)}">${esc(t.name)} ${roleBadge(t)}</button><span class="${t.deadline < base ? "overdue" : ""}">${t.deadline < base ? "期限超過 · " : ""}${esc(t.deadline)}</span></div>`,
        )
        .join("")
    : '<p class="muted">7日以内・期限超過の締切はありません。</p>';
  $("today-label").textContent = new Intl.DateTimeFormat("ja-JP", {month:"long",day:"numeric",weekday:"short",timeZone:"UTC"}).format(new Date(base));
  $("today-label").title = base + " · 日本時間";
  $("due-count").textContent = due.length ? due.length + "件" : "";
  planner.renderList(list,mode,base);
  $("list-view").setAttribute("aria-pressed", mode === "list");
  $("board-view").setAttribute("aria-pressed", mode === "board");
  renderRecovery();
  setBusy(busy);
}
function openDialog(dialog, replace = false) {
  dialogEpoch++;
  dialog.returnFocus = document.activeElement;
  dialog.dataset.baseRevision = String(state.revision);
  dialog.dataset.stale = "false";
  dialog.querySelector("[data-dialog-conflict]").hidden = true;
  setBusy(busy);
  dialog.showModal();
  if (replace) history.replaceState({ todoDialog: dialog.id }, "");
  else history.pushState({ todoDialog: dialog.id }, "");
}
$("detail").addEventListener("keydown", event => {
  if (event.key !== "Tab") return;
  const visible = [...$("detail").querySelectorAll("button, input, select, textarea, summary, a[href]")]
    .filter(el => !el.disabled && el.getClientRects().length && !el.closest("details:not([open]) > :not(summary)"));
  const first = visible[0], last = visible.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});
function restoreDialogFocus(target) {
  if (target && !target.isConnected) {
    const taskId = target.closest("[data-task]")?.dataset.task;
    const action = target.dataset.action;
    if (taskId && action)
      target = document.querySelector(
        `[data-task="${CSS.escape(taskId)}"] [data-action="${CSS.escape(action)}"]`,
      );
    else if (target.dataset.deadline)
      target = document.querySelector(
        `[data-deadline="${CSS.escape(target.dataset.deadline)}"]`,
      );
  }
  if (target && !target.disabled && target.getClientRects().length)
    target.focus();
}
function closeDialog(dialog, fromBack = false) {
  if (!dialog.open) return;
  dialogEpoch++;
  dialog.close();
  if (dialog.id === "detail") document.querySelector(".inspected")?.classList.remove("inspected");
  if (dialog.id === "capture-sheet") planner.clearCapture();
  const target = dialog.returnFocus;
  if (target?.disabled) pendingFocusRestore = { target, epoch: dialogEpoch };
  else restoreDialogFocus(target);
  if (!fromBack && history.state?.todoDialog === dialog.id) history.back();
}
window.addEventListener("popstate", () =>
  document
    .querySelectorAll(".todo-page dialog[open]")
    .forEach((d) => closeDialog(d, true)),
);
for (const dialog of document.querySelectorAll(".todo-page dialog")) {
  const conflict = document.createElement("div");
  conflict.dataset.dialogConflict = "";
  conflict.hidden = true;
  conflict.innerHTML =
    '<p role="alert">別の更新があるか、保存結果を確認できません。古い内容で上書きしないよう編集を止めました。</p><button type="button" data-dialog-reload>最新の内容を読み直す（入力を破棄）</button>';
  dialog.prepend(conflict);
  conflict.querySelector("button").onclick = async () => {
    const epoch = dialogEpoch;
    setBusy(true);
    try {
      await reload();
      if (!dialog.open || epoch !== dialogEpoch) return;
      if (dialog.id === "detail") {
        if (!state.tasks.some((task) => task.id === editId)) {
          closeDialog(dialog);
          message("このタスクは削除されています");
          return;
        }
        openDetail(editId, false);
      } else if (dialog.id === "reschedule-dialog") { closeDialog(dialog); return; }
      else if (dialog.id === "organizer") planner.refreshManager();
      else if (dialog.id === "role-dialog") renderRoles();
      else if (dialog.id === "categories-dialog") renderCategories();
      dialog.dataset.baseRevision = String(state.revision);
      dialog.dataset.stale = "false";
      conflict.hidden = true;
    } catch {
      message("最新の内容を取得できませんでした。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  };
  dialog
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.onclick = () => closeDialog(dialog)));
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog(dialog);
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closeDialog(dialog);
    }
  });
}
function renderSteps() {
  $("checklist-editor").innerHTML = checklist
    .map(
      (c, i) =>
        `<div class="step"><input type="checkbox" data-step="${i}" aria-label="${esc(c.text)}" ${c.checked ? "checked" : ""}><span>${esc(c.text)}</span><button type="button" data-remove="${i}" aria-label="ステップを削除：${esc(c.text)}">×</button></div>`,
    )
    .join("");
}
function showTaskSummary(visible) {
  const dialog = $("detail");
  $("task-summary").hidden = !visible;
  $("detail-form").hidden = visible;
  dialog.setAttribute("aria-labelledby", visible ? "summary-name" : "detail-heading");
}
function syncShortcuts(form, field) {
  const base = today();
  for (const button of form.querySelectorAll("[data-offset]")) {
    button.setAttribute("aria-pressed", String(field.value === offset(base, Number(button.dataset.offset))));
  }
}
function connectShortcuts(form, field) {
  form.addEventListener("click", event => {
    const button = event.target.closest("button[data-offset]");
    if (!button || busy || form.closest("dialog").dataset.stale === "true") return;
    field.value = offset(today(), Number(button.dataset.offset));
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  field.addEventListener("input", () => syncShortcuts(form, field));
}
connectShortcuts($("capture"), $("capture-day"));
connectShortcuts($("detail-form"), $("detail-form").elements.plannedDay);
const workDate = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric", month: "short", day: "numeric", weekday: "short", timeZone: "UTC",
});
function fillSummary(t) {
  const done = statusOf(t) === "done";
  $("summary-name").textContent = t.name;
  $("summary-day").querySelector("strong").textContent = t.plannedDay ? workDate.format(new Date(t.plannedDay)) : "未設定";
  $("summary-memo").textContent = t.memo || "未入力";
  $("summary-deadline").textContent = t.deadline || "未設定";
  $("summary-project").textContent = $("task-project").selectedOptions[0]?.textContent || "未設定";
  $("summary-priority").textContent = $("task-priority").selectedOptions[0]?.textContent || "通常";
  $("summary-reminder").textContent = t.plan?.reminder?.replace("T", " ") || "なし";
  $("summary-complete").textContent = done ? "未完了に戻す" : "完了する";
  $("summary-error").textContent = "";
}
function editSummary(field) {
  showTaskSummary(false);
  field.focus();
}
$("summary-edit").onclick = () => editSummary($("detail-form").elements.name);
$("summary-day").onclick = () => editSummary($("detail-form").elements.plannedDay);
$("summary-complete").onclick = () => toggleCompletion(editId, $("detail"));
$("cancel-detail-edit").onclick = () => {
  if ($("detail").dataset.summaryFirst !== "true") return closeDialog($("detail"));
  openDetail(editId, false);
  showTaskSummary(true);
  $("summary-edit").focus();
};
function openDetail(id, show = true) {
  editId = id;
  const t = state.tasks.find((t) => t.id === id),
    f = $("detail-form");
  f.elements.roleId.innerHTML =
    '<option value="">指定なし</option>' +
    state.roles
      .filter((r) => !r.archived || r.id === t.roleId)
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.icon)} ${esc(r.name)}${r.archived ? "（保管）" : ""}</option>`,
      )
      .join("");
  f.elements.category.innerHTML = [
    ...new Set([...state.categories, t.category]),
  ]
    .map((c) => `<option>${esc(c)}</option>`)
    .join("");
  for (const key of [
    "name",
    "category",
    "roleId",
    "plannedDay",
    "deadline",
    "priority",
    "memo",
    "reusableDescription",
  ])
    f.elements[key].value = t[key] ?? "";
  f.elements.status.value = statusOf(t);
  f.elements.important.checked = !!t.important;
  planner.fillDetail(t);
  syncShortcuts(f, f.elements.plannedDay);
  fillSummary(t);
  checklist = structuredClone(t.checklist || []);
  renderSteps();
  $("step-text").value = "";
  $("detail-error").textContent = "";
  if (show) {
    for (const section of $("detail-form").querySelectorAll(".detail-section")) section.open = false;
    $("summary-settings").open = false;
    const summaryFirst = matchMedia("(max-width: 730px)").matches;
    $("detail").dataset.summaryFirst = String(summaryFirst);
    showTaskSummary(summaryFirst);
    const row = document.querySelector(`[data-task="${CSS.escape(id)}"]`);
    row?.classList.add("inspected");
    openDialog($("detail"));
  }
}
$("step-add").onclick = () => {
  const input = $("step-text");
  if (input.value.trim() && checklist.length < 200) {
    checklist.push({
      id: crypto.randomUUID(),
      text: input.value.trim(),
      checked: false,
    });
    input.value = "";
    renderSteps();
    input.focus();
  }
};
$("step-text").onkeydown = (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.isComposing || e.keyCode === 229) return;
    $("step-add").click();
  }
};
$("checklist-editor").onchange = (e) => {
  if (e.target.dataset.step !== undefined)
    checklist[+e.target.dataset.step].checked = e.target.checked;
};
$("checklist-editor").onclick = (e) => {
  const i = e.target.dataset.remove;
  if (i !== undefined) {
    checklist.splice(+i, 1);
    renderSteps();
  }
};
$("detail-form").onsubmit = async (e) => {
  e.preventDefault();
  if (busy || $("detail").dataset.stale === "true" || $("detail-form").hidden) return;
  const epoch = dialogEpoch,
    next = structuredClone(state),
    t = next.tasks.find((t) => t.id === editId),
    f = e.target;
  for (const key of ["name", "category", "memo", "reusableDescription"])
    t[key] = f.elements[key].value.trim();
  for (const key of ["roleId", "plannedDay", "deadline"])
    t[key] = f.elements[key].value || null;
  t.priority = f.elements.priority.value
    ? Number(f.elements.priority.value)
    : null;
  t.important = f.elements.important.checked;
  t.checklist = structuredClone(checklist);
  try { planner.readDetail(t); } catch (error) { $("detail-error").textContent=error.message;return; }
  const previous = statusOf(t);
  t.status = f.elements.status.value;
  if (t.status !== previous) {
    t.progress = t.status === "done" ? 100 : 0;
    t.completedAt = t.status === "done" ? new Date().toISOString() : null;
  }
  const ok = await save(next);
  if (epoch !== dialogEpoch) return;
  if (!ok) { $("detail-error").textContent = $("notice").textContent; return; }
  if ($("detail").dataset.summaryFirst === "true") {
    openDetail(editId, false);
    showTaskSummary(true);
    $("summary-edit").focus();
  } else closeDialog($("detail"));
};
$("task-delete").onclick = async () => {
  const id = editId,
    epoch = dialogEpoch;
  if (!confirm("このタスクを削除しますか？")) return;
  const next = structuredClone(state);
  next.tasks = next.tasks.filter((t) => t.id !== id);
  for (const t of next.tasks) if (t.plan?.parent===id) t.plan.parent=null;
  if ((await save(next)) && epoch === dialogEpoch) closeDialog($("detail"));
};
$("quick-title").onkeydown = (e) => {
  if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
};
$("capture").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const epoch = dialogEpoch;
  if (!$("capture-sheet").open || $("capture-sheet").dataset.stale === "true") return;
  const name = $("quick-title").value.trim(),
    captureBase = today(),
    plannedDay = $("capture-day").value || null;
  if (!name) return;
  const next = structuredClone(state);
  next.tasks.push({
    id: crypto.randomUUID(),
    name,
    category: state.categories[0] || "その他",
    priority: null,
    deadline: null,
    progress: 0,
    memo: $("capture-memo").value.trim(),
    createdAt: captureBase,
    plannedDay,
    status: "pending",
  });
  const task=next.tasks.at(-1);
  try { planner.capture(next,task); } catch(error) { $("capture-error").textContent = error.message; return; }
  if (await save(next, task.plannedDay ? task.plannedDay+" の予定に追加しました" : task.plan.project ? "プロジェクトに追加しました" : "インボックスに追加しました")) {
    if (epoch !== dialogEpoch) return;
    $("quick-title").value = "";
    $("task-search").value = $("role-filter").value = $("category-filter").value = "";
    planner.captured(task);
  } else $("capture-error").textContent = $("notice").textContent;
};
$("tasks").onclick = async (e) => {
  const button = e.target.closest("button[data-action]");
  if (busy) return;
  if (!button) {
    const row = e.target.closest("[data-task]");
    if (row && !e.target.closest("a,button,details,.drag-grip")) row.querySelector("[data-action=detail]").click();
    return;
  }
  const id = button.closest("[data-task]").dataset.task;
  if (button.dataset.action === "detail") openDetail(id);
  if (button.dataset.action === "clone")
    startClone(id, Number(button.dataset.days), today());
  if (button.dataset.action === "custom-clone") openClone(id);
  if (["up","down"].includes(button.dataset.action)) return planner.changeOrder(button,button.dataset.action==="up"?-1:1);
  if (["plan-today","tomorrow"].includes(button.dataset.action)) {
    const next = structuredClone(state);
    next.tasks.find((t) => t.id === id).plannedDay = offset(today(),button.dataset.action==="tomorrow"?1:0);
    await save(next, "予定日を変更しました。締切は変更していません");
    document.querySelector(`[data-task="${CSS.escape(id)}"] [data-action="detail"]`)?.focus();
  }
  if (button.dataset.action === "complete") await toggleCompletion(id);
};
async function toggleCompletion(id, dialog = null) {
  if (busy || dialog?.dataset.stale === "true") return;
  const epoch = dialogEpoch;
  const next = structuredClone(state);
  const task = next.tasks.find(item => item.id === id);
  if (!task) return;
  const previous = { status: statusOf(task), progress: task.progress, completedAt: task.completedAt };
  const done = previous.status !== "done";
  task.status = done ? "done" : "pending";
  task.progress = done ? 100 : 0;
  task.completedAt = done ? new Date().toISOString() : null;
  const result = await save(next, `「${task.name}」を${done ? "完了" : "未完了に変更"}しました`);
  if (!result) {
    if (dialog?.open && epoch === dialogEpoch) $("summary-error").textContent = $("notice").textContent;
    return;
  }
  if (dialog?.open && epoch === dialogEpoch) closeDialog(dialog);
  const revision = state.revision;
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "undo-completion";
  undo.textContent = "元に戻す";
  undo.onclick = async () => {
    if (busy) return;
    if (state.revision !== revision) return message("タスクが更新されました。詳細を確認してください。", true);
    const restored = structuredClone(state);
    Object.assign(restored.tasks.find(item => item.id === id), previous);
    await save(restored, "タスクの状態を元に戻しました");
  };
  if (done && task.plan?.repeat && !task.plan.repeatIssued) $("notice").append("（次回分は予定に残ります）");
  $("notice").append(undo);
}
$("deadlines").onclick = (e) => {
  const b = e.target.closest("[data-deadline]");
  if (b && !busy) openDetail(b.dataset.deadline);
};
$("task-search").oninput = render;
$("clear-filters").onclick = () => {
  $("task-search").value = $("role-filter").value = $("category-filter").value = "";
  render();
  $("task-search").focus();
};
$("role-filter").onchange = render;
$("category-filter").onchange = render;
$("list-view").onclick = () => {
  mode = "list";
  render();
};
$("board-view").onclick = () => {
  mode = "board";
  render();
};
function renderRoles() {
  const focusedRole =
    document.activeElement.closest("[data-role]")?.dataset.role;
  const focusAction = document.activeElement.hasAttribute("data-archive")
    ? "[data-archive]"
    : "[data-role-save]";
  $("role-list").innerHTML =
    state.roles
      .map(
        (r) =>
          `<div class="role-row" data-role="${esc(r.id)}"><span ${roleBadgeAttrs(r.color)}>${esc(r.icon)}</span><input class="role-name" value="${esc(r.name)}" maxlength="100" aria-label="役割名：${esc(r.name)}"><select data-role-icon aria-label="役割のアイコン">${["📚", "👥", "📝", "🏠", "💼", "⭐"].map((i) => `<option ${i === r.icon ? "selected" : ""}>${i}</option>`).join("")}</select><input type="color" data-role-color aria-label="表示色：${esc(r.name)}" value="${colorValue(r.color)}"><button data-role-save>変更を保存</button><button data-archive>${r.archived ? "再開" : "アーカイブ"}</button></div>`,
      )
      .join("") || '<p class="empty">自分の役割を登録しましょう。</p>';
  if (focusedRole)
    $("role-list")
      .querySelector(`[data-role="${CSS.escape(focusedRole)}"] ${focusAction}`)
      ?.focus();
}
$("roles-open").onclick = () => {
  renderRoles();
  $("role-error").textContent = "";
  openDialog($("role-dialog"));
};
$("role-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target,
    next = structuredClone(state),
    epoch = dialogEpoch;
  next.roles.push({
    id: crypto.randomUUID(),
    name: f.elements.name.value.trim(),
    icon: f.elements.icon.value,
    color: f.elements.color.value,
    archived: false,
  });
  if ((await save(next)) && epoch === dialogEpoch) {
    f.reset();
    renderRoles();
  }
};
$("role-list").onclick = async (e) => {
  if (busy) return;
  const row = e.target.closest("[data-role]");
  if (!row) return;
  const next = structuredClone(state),
    r = next.roles.find((r) => r.id === row.dataset.role),
    epoch = dialogEpoch;
  if (e.target.hasAttribute("data-archive")) r.archived = !r.archived;
  else if (e.target.hasAttribute("data-role-save")) {
    r.name = row.querySelector("input").value.trim();
    r.icon = row.querySelector("[data-role-icon]").value;
    const color = row.querySelector("[data-role-color]").value;
    if (color !== colorValue(r.color)) r.color = color;
    if (!r.name) return;
  } else return;
  if ((await save(next)) && epoch === dialogEpoch) renderRoles();
};
function renderCategories() {
  const focusedIndex = document.activeElement.closest("[data-category-index]")
    ?.dataset.categoryIndex;
  const focusAction = document.activeElement.dataset.categoryAction || "rename";
  $("categories-list").innerHTML =
    state.categories
      .map((category, index) => {
        const used = state.tasks.some((t) => t.category === category);
        return `<div class="category-row" data-category-index="${index}"><label>カテゴリ名<input value="${esc(category)}" maxlength="100"></label><div class="inline"><button data-category-action="rename">名前を保存</button><button data-category-action="up" aria-label="上へ移動：${esc(category)}" ${index === 0 ? "disabled data-fixed-disabled" : ""}>↑</button><button data-category-action="down" aria-label="下へ移動：${esc(category)}" ${index === state.categories.length - 1 ? "disabled data-fixed-disabled" : ""}>↓</button></div>${
          used
            ? `<label>削除するときの移動先<select>${state.categories
                .filter((c) => c !== category)
                .map((c) => `<option>${esc(c)}</option>`)
                .join("")}</select></label>`
            : ""
        }<button data-category-action="remove" class="danger" ${used && state.categories.length === 1 ? "disabled data-fixed-disabled" : ""}>${used ? "削除・選択先へ再割当" : "削除"}</button></div>`;
      })
      .join("") || '<p class="empty">カテゴリはまだありません。</p>';
  if (focusedIndex !== undefined) {
    const index = Math.min(Number(focusedIndex), state.categories.length - 1);
    const target = $("categories-list").querySelector(
      `[data-category-index="${index}"] [data-category-action="${CSS.escape(focusAction)}"]`,
    );
    (target && !target.disabled
      ? target
      : $("categories-form").elements.name
    ).focus();
  }
}
$("categories-open").onclick = () => {
  renderCategories();
  openDialog($("categories-dialog"));
};
$("categories-form").onsubmit = async (event) => {
  event.preventDefault();
  const name = event.target.elements.name.value.trim();
  if (!name || state.categories.includes(name)) {
    message("カテゴリ名が空か、すでに登録されています");
    return;
  }
  const next = structuredClone(state),
    epoch = dialogEpoch;
  next.categories.push(name);
  if ((await save(next)) && epoch === dialogEpoch) {
    event.target.reset();
    renderCategories();
  }
};
$("categories-list").onclick = async (event) => {
  const action = event.target.dataset.categoryAction;
  if (!action || busy) return;
  const row = event.target.closest("[data-category-index]"),
    index = Number(row.dataset.categoryIndex);
  const next = structuredClone(state),
    category = next.categories[index],
    epoch = dialogEpoch;
  if (action === "rename") {
    const name = row.querySelector("input").value.trim();
    if (!name || next.categories.some((c, i) => i !== index && c === name)) {
      message("カテゴリ名が空か、すでに登録されています");
      return;
    }
    next.categories[index] = name;
    for (const task of next.tasks)
      if (task.category === category) task.category = name;
  } else if (action === "remove") {
    const used = next.tasks.some((t) => t.category === category),
      target = row.querySelector("select")?.value;
    if (used && !target) return;
    if (
      !confirm(
        used
          ? `「${category}」を削除し、タスクを「${target}」へ移動しますか？`
          : `「${category}」を削除しますか？`,
      )
    )
      return;
    next.categories.splice(index, 1);
    for (const task of next.tasks)
      if (task.category === category) task.category = target;
  } else {
    const destination = index + (action === "up" ? -1 : 1);
    if (destination < 0 || destination >= next.categories.length) return;
    [next.categories[index], next.categories[destination]] = [
      next.categories[destination],
      next.categories[index],
    ];
  }
  if ((await save(next)) && epoch === dialogEpoch) renderCategories();
};
function persistPending(args) {
  localStorage.setItem(pendingPrefix + args.request_id, JSON.stringify(args));
  pending = readPending();
  renderRecovery();
}
function renderRecovery() {
  pending = readPending();
  $("recovery").innerHTML = Object.values(pending)
    .map(
      (args) =>
        `<div>複製の結果を確認中 · 予定 ${offset(args.base_day, args.offset_days)} <button data-retry="${esc(args.request_id)}">結果確認・同じ操作を再試行</button></div>`,
    )
    .join("");
}
$("recovery").onclick = (event) => {
  const key = event.target.dataset.retry;
  pending = readPending();
  if (key && pending[key] && !busy) runClone(pending[key]);
};
async function runClone(args) {
  if (busy) return false;
  setBusy(true);
  let committed = false;
  try {
    let result = await api(
      "/clone?request_id=" + encodeURIComponent(args.request_id),
    );
    if (result.found === false)
      result = await api("/clone", {
        method: "POST",
        body: JSON.stringify(args),
      });
    committed = true;
    // Keep the durable retry record until the current list has also loaded.
    await reload();
    localStorage.removeItem(pendingPrefix + args.request_id);
    renderRecovery();
    message(`${result.plannedDay} に複製しました。元のタスクはそのままです。`);
    return true;
  } catch {
    message(
      committed
        ? "複製は保存済みですが、一覧を読み込めません。「結果確認・同じ操作を再試行」で表示を回復できます。"
        : "複製の結果を確認できません。同じ操作の「結果確認・再試行」で回収できます。",
    );
    return false;
  } finally {
    setBusy(false);
  }
}
function startClone(id, days, base, deadline = null) {
  if (busy) return Promise.resolve(false);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    message("日数は1〜3650日で指定してください");
    return Promise.resolve(false);
  }
  pending = readPending();
  // An unresolved identical action is a retry, not a new independent clone.
  const existing = Object.values(pending).find(
    (args) =>
      args.id === id &&
      args.base_day === base &&
      args.offset_days === days &&
      (args.deadline ?? null) === deadline,
  );
  if (existing) return runClone(existing);
  const args = {
    id,
    request_id: crypto.randomUUID(),
    base_day: base,
    offset_days: days,
    deadline,
  };
  try {
    persistPending(args);
  } catch {
    message(
      "再試行情報をこのブラウザに保存できないため、複製を送信しませんでした。ブラウザの保存設定をご確認ください。",
    );
    return Promise.resolve(false);
  }
  render();
  message(`${offset(base, days)} に複製しています（日本時間）…`);
  return runClone(args);
}
function clonePreview() {
  const f = $("clone-form"),
    days = Number(f.elements.amount.value) * Number(f.elements.unit.value);
  $("clone-target").textContent =
    Number.isInteger(days) && days >= 1 && days <= 3650
      ? `新しい予定日：${offset(cloneBase, days)}（日本時間）`
      : "1〜3650日を指定してください";
  $("deadline-preview").textContent =
    `新しい締切：${f.elements.deadline.value || "なし"}`;
}
function openClone(id) {
  cloneSource = id;
  cloneBase = today();
  const f = $("clone-form");
  f.reset();
  $("clone-source").textContent = state.tasks.find((t) => t.id === id).name;
  $("clone-error").textContent = "";
  clonePreview();
  openDialog($("clone-dialog"));
}
$("clone-form").oninput = clonePreview;
$("copy-deadline").onclick = () => {
  $("clone-form").elements.deadline.value =
    state.tasks.find((t) => t.id === cloneSource).deadline || "";
  clonePreview();
};
$("clone-form").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target,
    epoch = dialogEpoch;
  const ok = await startClone(
    cloneSource,
    Number(f.elements.amount.value) * Number(f.elements.unit.value),
    cloneBase,
    f.elements.deadline.value || null,
  );
  if (ok && epoch === dialogEpoch) closeDialog($("clone-dialog"));
};
$("sign-in").onclick = signIn;
$("sign-out").onclick = async () => {
  await signOutUser();
  location.reload();
};
const planner=createPlanner({$,esc,state:()=>state,save,api,render,group,openDialog,closeDialog,openDetail,today,message,syncShortcuts});
watchAuth({
  onSignedIn: async () => {
    $("sign-out").hidden = false;
    try {
      await reload();
      $("login-screen").hidden = true;
      $("app").hidden = false;
      planner.initial();
    } catch (e) {
      $("login-screen").hidden = false;
      $("login-message").textContent = "読み込みに失敗しました：" + e.message;
    }
  },
  onSignedOut: (msg) => {
    plannerReady = false;
    $("login-screen").hidden = false;
    $("sign-out").hidden = true;
    $("app").hidden = true;
    $("login-message").textContent =
      msg || "Googleアカウントでサインインしてください";
    $("sign-in").hidden = false;
  },
});
