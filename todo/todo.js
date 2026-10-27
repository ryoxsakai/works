import {
  watchAuth,
  signIn,
  signOutUser,
  getSessionToken,
} from "../shared/auth.js";
const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
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
  busy = false,
  mode = "list",
  editId,
  checklist = [],
  cloneSource,
  cloneBase,
  dialogEpoch = 0;
let pending = {};
try {
  pending = JSON.parse(localStorage.getItem(pendingKey) || "{}");
} catch {}
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
function message(text) {
  $("notice").textContent = text;
}
function setBusy(value) {
  busy = value;
  document
    .querySelectorAll(
      "#app button,#app input,#app select,dialog button:not([data-close]),dialog input,dialog select,dialog textarea",
    )
    .forEach(
      (el) => (el.disabled = value || el.hasAttribute("data-fixed-disabled")),
    );
}
async function reload() {
  state = await api();
  render();
}
async function save(next, success = "保存しました") {
  if (busy) return false;
  const focusOrigin = document.activeElement;
  setBusy(true);
  try {
    state = await api("", { method: "PUT", body: JSON.stringify(next) });
    render();
    message(success);
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
function roleBadge(t) {
  const r = state.roles.find((r) => r.id === t.roleId);
  return r
    ? `<span class="badge role-${esc(r.color)}">${esc(r.icon)} ${esc(r.name)}${r.archived ? "（保管）" : ""}</span>`
    : "";
}
function card(t) {
  const done = statusOf(t) === "done",
    base = today();
  return `<article class="task-card" data-task="${esc(t.id)}"><div class="task-top"><button class="done-toggle" data-action="complete" aria-label="${done ? "未着手に戻す" : "完了にする"}：${esc(t.name)}">${done ? "✓" : "○"}</button><div><p class="task-name">${t.important ? "★ " : ""}${esc(t.name)}</p><div class="task-meta">${roleBadge(t)}<span class="badge">${statusNames[statusOf(t)]}</span>${t.plannedDay ? `<span class="badge">予定 ${esc(t.plannedDay)}</span>` : ""}${t.deadline ? `<span class="badge ${t.deadline < base && !done ? "overdue" : ""}">締切 ${esc(t.deadline)}</span>` : ""}${t.priority ? `<span class="badge">重要度 ${["", "低", "中", "高"][t.priority]}</span>` : ""}${t.checklist?.length ? `<span class="badge">ステップ ${t.checklist.filter((c) => c.checked).length}/${t.checklist.length}</span>` : ""}</div><p class="hint">カテゴリ：${esc(t.category)}${t.cloneSourceId ? " · 複製元の記録あり" : ""}${t.progress > 0 && t.progress < 100 ? ` · 従来の進捗 ${t.progress}%` : ""}</p></div><button class="detail-button" data-action="detail" aria-label="詳細：${esc(t.name)}">詳細</button></div><div class="task-actions">${[
    [1, "1日後"],
    [3, "3日後"],
    [7, "1週間後"],
    [14, "2週間後"],
  ]
    .map(
      ([n, label]) =>
        `<button class="clone-fast" data-action="clone" data-days="${n}" aria-label="${label}に複製：${esc(t.name)}">${label}に複製<span>${offset(base, n)}</span></button>`,
    )
    .join(
      "",
    )}<button data-action="custom-clone">日数・締切を指定</button></div></article>`;
}
function group(title, tasks, note = "") {
  return `<section class="group"><div class="group-heading"><h3>${esc(title)}</h3><span class="count">${tasks.length}件</span></div>${note ? `<p class="hint">${esc(note)}</p>` : ""}${tasks.length ? tasks.map(card).join("") : '<p class="empty">ここにはタスクがありません。</p>'}</section>`;
}
function render() {
  const role = $("role-filter").value,
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
  const list = state.tasks.filter(
      (t) =>
        (!role || t.roleId === role) && (!category || t.category === category),
    ),
    base = today();
  const active = list.filter((t) => statusOf(t) !== "done");
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
  $("today-label").textContent = `${base} · 日本時間（Asia/Tokyo）`;
  if (mode === "board")
    $("tasks").innerHTML = `<div class="board">${Object.entries(statusNames)
      .map(
        ([key, label]) =>
          `<div class="board-column">${group(
            label,
            list.filter((t) => statusOf(t) === key),
          )}</div>`,
      )
      .join("")}</div>`;
  else {
    const scheduled = active.filter(
      (t) => t.plannedDay && t.plannedDay <= base,
    );
    const focus = [...scheduled]
      .sort(
        (a, b) =>
          Number(b.important || b.priority === 3) -
          Number(a.important || a.priority === 3),
      )
      .slice(0, 3);
    const rest = scheduled.filter((t) => !focus.includes(t));
    const future = [
      ...new Set(
        active.filter((t) => t.plannedDay > base).map((t) => t.plannedDay),
      ),
    ].sort();
    $("tasks").innerHTML =
      group(
        "今日のフォーカス",
        focus,
        "まずは3件ほど。残りのタスクも下にすべて表示します。",
      ) +
      group(
        "今日・持ち越しの残り",
        rest,
        "持ち越しで締切は変更されません。詳細から予定日を変えられます。",
      ) +
      future
        .map((day) =>
          group(
            day === offset(base, 1) ? `明日 · ${day}` : day,
            active.filter((t) => t.plannedDay === day),
          ),
        )
        .join("") +
      group(
        "予定なし · インボックス",
        active.filter((t) => !t.plannedDay),
      ) +
      group(
        "完了の記録",
        list.filter((t) => statusOf(t) === "done"),
      );
  }
  $("list-view").setAttribute("aria-pressed", mode === "list");
  $("board-view").setAttribute("aria-pressed", mode === "board");
  renderRecovery();
  setBusy(busy);
}
function openDialog(dialog) {
  dialogEpoch++;
  dialog.returnFocus = document.activeElement;
  dialog.showModal();
  history.pushState({ todoDialog: dialog.id }, "");
}
function closeDialog(dialog, fromBack = false) {
  if (!dialog.open) return;
  dialogEpoch++;
  dialog.close();
  let target = dialog.returnFocus;
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
  target?.focus();
  if (!fromBack && history.state?.todoDialog === dialog.id) history.back();
}
window.addEventListener("popstate", () =>
  document
    .querySelectorAll("dialog[open]")
    .forEach((d) => closeDialog(d, true)),
);
for (const dialog of document.querySelectorAll("dialog")) {
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
function openDetail(id) {
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
  checklist = structuredClone(t.checklist || []);
  renderSteps();
  $("step-text").value = "";
  $("detail-error").textContent = "";
  openDialog($("detail"));
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
  const previous = statusOf(t);
  t.status = f.elements.status.value;
  if (t.status !== previous) {
    t.progress = t.status === "done" ? 100 : 0;
    t.completedAt = t.status === "done" ? new Date().toISOString() : null;
  }
  const ok = await save(next);
  if (ok && epoch === dialogEpoch) closeDialog($("detail"));
};
$("task-delete").onclick = async () => {
  const id = editId,
    epoch = dialogEpoch;
  if (!confirm("このタスクを削除しますか？")) return;
  const next = structuredClone(state);
  next.tasks = next.tasks.filter((t) => t.id !== id);
  if ((await save(next)) && epoch === dialogEpoch) closeDialog($("detail"));
};
$("capture").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const name = $("quick-title").value.trim();
  if (!name) return;
  const next = structuredClone(state);
  next.tasks.push({
    id: crypto.randomUUID(),
    name,
    category: state.categories[0] || "その他",
    priority: null,
    deadline: null,
    progress: 0,
    memo: "",
    createdAt: today(),
    plannedDay: null,
    status: "pending",
  });
  if (await save(next, "インボックスに追加しました")) {
    $("quick-title").value = "";
    $("quick-title").focus();
  }
};
$("tasks").onclick = async (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button || busy) return;
  const id = button.closest("[data-task]").dataset.task;
  if (button.dataset.action === "detail") openDetail(id);
  if (button.dataset.action === "clone")
    startClone(id, Number(button.dataset.days), today());
  if (button.dataset.action === "custom-clone") openClone(id);
  if (button.dataset.action === "complete") {
    const next = structuredClone(state),
      t = next.tasks.find((t) => t.id === id);
    t.status = statusOf(t) === "done" ? "pending" : "done";
    t.progress = t.status === "done" ? 100 : 0;
    t.completedAt = t.status === "done" ? new Date().toISOString() : null;
    await save(next);
  }
};
$("deadlines").onclick = (e) => {
  const b = e.target.closest("[data-deadline]");
  if (b && !busy) openDetail(b.dataset.deadline);
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
          `<div class="role-row" data-role="${esc(r.id)}"><span class="badge role-${esc(r.color)}">${esc(r.icon)}</span><input class="role-name" value="${esc(r.name)}" maxlength="100" aria-label="役割名：${esc(r.name)}"><select data-role-icon aria-label="役割のアイコン">${["📚", "👥", "📝", "🏠", "💼", "⭐"].map((i) => `<option ${i === r.icon ? "selected" : ""}>${i}</option>`).join("")}</select><select data-role-color aria-label="役割の色">${Object.entries(
            {
              blue: "ブルー",
              green: "グリーン",
              pink: "ピンク",
              purple: "パープル",
              yellow: "イエロー",
            },
          )
            .map(
              ([v, n]) =>
                `<option value="${v}" ${v === r.color ? "selected" : ""}>${n}</option>`,
            )
            .join(
              "",
            )}</select><button data-role-save>変更を保存</button><button data-archive>${r.archived ? "再開" : "アーカイブ"}</button></div>`,
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
    r.color = row.querySelector("[data-role-color]").value;
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
function persistPending() {
  localStorage.setItem(pendingKey, JSON.stringify(pending));
  renderRecovery();
}
function renderRecovery() {
  $("recovery").innerHTML = Object.values(pending)
    .map(
      (args) =>
        `<div>複製の結果を確認中 · 予定 ${offset(args.base_day, args.offset_days)} <button data-retry="${esc(args.request_id)}">結果確認・同じ操作を再試行</button></div>`,
    )
    .join("");
}
$("recovery").onclick = (e) => {
  const key = e.target.dataset.retry;
  if (key && !busy) runClone(pending[key]);
};
async function runClone(args) {
  if (busy) return false;
  setBusy(true);
  try {
    let result = await api(
      "/clone?request_id=" + encodeURIComponent(args.request_id),
    );
    if (result.found === false)
      result = await api("/clone", {
        method: "POST",
        body: JSON.stringify(args),
      });
    delete pending[args.request_id];
    persistPending();
    await reload();
    message(`${result.plannedDay} に複製しました。元のタスクはそのままです。`);
    return true;
  } catch (error) {
    message(
      "複製の結果を確認できません。同じ操作の「結果確認・再試行」で回収できます。",
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
  // Persist before dispatch, so response loss / reload reuses the same operation.
  const args = {
    id,
    request_id: crypto.randomUUID(),
    base_day: base,
    offset_days: days,
    deadline,
  };
  pending[args.request_id] = args;
  persistPending();
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
watchAuth({
  onSignedIn: async () => {
    try {
      await reload();
      $("login-screen").hidden = true;
      $("app").hidden = false;
      $("sign-out").hidden = false;
    } catch (e) {
      $("login-message").textContent = "読み込みに失敗しました：" + e.message;
    }
  },
  onSignedOut: (msg) => {
    $("app").hidden = true;
    $("login-message").textContent =
      msg || "Googleアカウントでサインインしてください";
    $("sign-in").hidden = false;
  },
});
