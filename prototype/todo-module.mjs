// Source-faithful native adapter of todo/todo.js. Original pages remain untouched.
import view from './todo-view.html?raw';
import './todo-native.css';
export function mountTodo(root,context,{id:routeId,navigate}) {
const lifecycle=new AbortController();let alive=true,blocked=false,pageOverflow,approvedClose=false;
const remembered=context.todoState ||= {mode:'list',query:'',role:'',category:''};let firstRender=true;
root.classList.add('todo-native');root.innerHTML='<p><a class="external" href="/todo/">従来のToDo画面へ ↗</a></p><div data-todo-reconcile hidden><p role="alert">保存を停止しています。入力は保持しています。再送せず最新の内容を確認してください。</p><button data-inspect>最新の保存内容を確認</button><button data-reset>入力を破棄して最新を開く</button><button data-export>入力をダウンロード</button><pre hidden></pre></div>'+view;
const page=root.closest('.page-content');
function lockPage(lock){if(!page)return;if(lock){pageOverflow=page.style.overflow;page.style.overflow='hidden';}else page.style.overflow=pageOverflow||'';}
function dialogSnapshot(dialog){return JSON.stringify([...dialog.querySelectorAll('input,select,textarea')].map(input=>[input.name||input.id,input.type==='checkbox'?input.checked:input.value]).concat(dialog.id==='todo-native-detail'?[checklist]:[]));}
function dialogDirty(dialog){return dialog.open&&dialog.dataset.inputSnapshot!==dialogSnapshot(dialog);}
function dirty(){return !!$('quick-title')?.value.trim()||[...root.querySelectorAll('dialog[open]')].some(dialogDirty);}
function renderBlocked(){root.querySelector('[data-todo-reconcile]').hidden=!blocked;}
const $ = (id) => root.querySelector("#todo-native-"+id);
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
  mode = remembered.mode,
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
}, {signal:lifecycle.signal});
async function api(path = "", options = {}) {
  if (!alive) throw new DOMException('ToDo closed','AbortError');
  const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
  const result=await context.request('/api/todo'+path,{...options,body,signal:lifecycle.signal});
  if(!alive)throw new DOMException('ToDo closed','AbortError');
  return result;
}
function message(text) {
  if(!alive)return;
  $("notice").textContent = text;
}
function setBusy(value) {
  if(!alive)return;
  busy = value;
  root
    .querySelectorAll(
      "#todo-native-app button,#todo-native-app input,#todo-native-app select,dialog button:not([data-close]),dialog input,dialog select,dialog textarea",
    )
    .forEach((el) => {
      const stale = el.closest("dialog")?.dataset.stale === "true";
      el.disabled =
        value ||
        (!state && !el.hasAttribute("data-load-retry")) ||
        (blocked && !el.hasAttribute("data-dialog-reload") && !el.hasAttribute("data-recovery-safe")) ||
        el.hasAttribute("data-fixed-disabled") ||
        (stale && !el.hasAttribute("data-dialog-reload") && !el.hasAttribute("data-recovery-safe"));
    });
  if (!value && pendingFocusRestore) {
    const pending = pendingFocusRestore;
    pendingFocusRestore = null;
    if (
      pending.epoch === dialogEpoch &&
      !root.querySelector("dialog[open]")
    )
      restoreDialogFocus(pending.target);
  }
}
async function reload() {
  const result=await api();
  if(!Number.isSafeInteger(result?.revision)||result.revision<0||![result.tasks,result.categories,result.roles].every(Array.isArray))throw Error("ToDo応答を確認できません");
  state=result;
  render();
}
async function save(next, success = "保存しました") {
  if (busy || blocked || !alive) return false;
  const focusOrigin = document.activeElement;
  const dialog = root.querySelector("dialog[open]"),
    epoch = dialogEpoch;
  // Every form stays bound to the revision it originally displayed.
  if (dialog) next.revision = Number(dialog.dataset.baseRevision);
  setBusy(true);
  try {
    const saved = await api("", { method: "PUT", body: JSON.stringify(next) });
    if(!Number.isSafeInteger(saved?.revision)||saved.revision!==next.revision+1||JSON.stringify(saved.tasks)!==JSON.stringify(next.tasks)||JSON.stringify(saved.categories)!==JSON.stringify(next.categories)||JSON.stringify(saved.roles)!==JSON.stringify(next.roles))throw Error("保存応答を確認できません");
    state=saved; blocked=false;
    render();
    if (dialog?.open && epoch === dialogEpoch)
      dialog.dataset.baseRevision = String(state.revision);
    if(dialog?.open)dialog.dataset.inputSnapshot=dialogSnapshot(dialog);
    message(success);
    return true;
  } catch (error) {
    if(!alive)return false;
    blocked=true;
    message(
      error.status === 409
        ? "別の更新があります。入力を保持し保存を停止しました。最新の内容を確認してください。"
        : "保存結果を確認できません。再読み込みして内容を確認してください。",
    );
    renderBlocked();
    if (
      dialog?.open &&
      epoch === dialogEpoch &&
      (blocked)
    ) {
      dialog.dataset.stale = "true";
      dialog.querySelector("[data-dialog-conflict]").hidden = false;
    }
    return false;
  } finally {
    if(!alive)return;
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
  return `<article class="task-card" data-task="${esc(t.id)}"><div class="task-top"><button class="done-toggle" data-action="complete" aria-label="${done ? "未着手に戻す" : "完了にする"}：${esc(t.name)}">${done ? "✓" : "○"}</button><div><p class="task-name">${t.important ? "★ " : ""}${esc(t.name)}</p><div class="task-meta">${roleBadge(t)}<span class="badge">${statusNames[statusOf(t)]}</span>${t.plannedDay ? `<span class="badge">予定 ${esc(t.plannedDay)}</span>` : ""}${t.deadline ? `<span class="badge ${t.deadline < base && !done ? "overdue" : ""}">締切 ${esc(t.deadline)}</span>` : ""}${t.priority ? `<span class="badge">重要度 ${["", "低", "中", "高"][t.priority]}</span>` : ""}${t.checklist?.length ? `<span class="badge">ステップ ${t.checklist.filter((c) => c.checked).length}/${t.checklist.length}</span>` : ""}</div><p class="hint">カテゴリ：${esc(t.category)}${t.cloneSourceId ? " · 複製元の記録あり" : ""}${t.progress > 0 && t.progress < 100 ? ` · 従来の進捗 ${t.progress}%` : ""}</p></div><button class="detail-button" data-action="detail" aria-label="詳細：${esc(t.name)}">詳細</button></div><p class="clone-caption">独立したタスクを複製（今日から）</p><div class="task-actions">${[
    [1, "1日後"],
    [3, "3日後"],
    [7, "1週間後"],
    [14, "2週間後"],
  ]
    .map(
      ([n, label]) =>
        `<button class="clone-fast" data-action="clone" data-days="${n}" title="${offset(base, n)} に独立したタスクを複製" aria-label="${label}に複製：${esc(t.name)}">${label}<span class="sr-only">に複製</span></button>`,
    )
    .join(
      "",
    )}<button data-action="custom-clone">その他の複製</button>${!done && t.plannedDay !== base ? '<button data-action="plan-today">今日に予定</button>' : ""}</div></article>`;
}
function group(title, tasks, note = "") {
  return `<section class="group"><div class="group-heading"><h3>${esc(title)}</h3><span class="count">${tasks.length}件</span></div>${note ? `<p class="hint">${esc(note)}</p>` : ""}${tasks.length ? tasks.map(card).join("") : '<p class="empty">ここにはタスクがありません。</p>'}</section>`;
}
function render() {
  if(firstRender){$("task-search").value=remembered.query;firstRender=false;}
  let role = $("role-filter").value || (state ? remembered.role : ""),
    category = $("category-filter").value || (state ? remembered.category : "");
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
  remembered.role=role;remembered.category=category;remembered.query=$("task-search").value;remembered.mode=mode;
  const list = state.tasks.filter(
      (t) =>
        (!role || t.roleId === role) && (!category || t.category === category) &&
        (!$("task-search").value.trim() || [t.name, t.memo, t.reusableDescription].join(" ").toLocaleLowerCase().includes($("task-search").value.trim().toLocaleLowerCase())),
    ),
    base = today();
  const filtered = !!(role || category || $("task-search").value.trim());
  $("clear-filters").hidden = !filtered;
  $("task-count").textContent = `${list.length}件表示 / 全${state.tasks.length}件${filtered ? " · 絞り込み中（締切の確認は全件）" : ""}`;
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
  if (!list.length) $("tasks").innerHTML = `<p class="empty">${filtered ? "条件に合うタスクがありません。絞り込みを解除して確認できます。" : "タスクはまだありません。上の入力欄にタイトルを入れて追加しましょう。"}</p>`;
  $("list-view").setAttribute("aria-pressed", mode === "list");
  $("board-view").setAttribute("aria-pressed", mode === "board");
  renderRecovery();
  setBusy(busy);
}
function openDialog(dialog) {
  dialogEpoch++;
  dialog.returnFocus = document.activeElement;
  dialog.dataset.baseRevision = String(state.revision);
  dialog.dataset.stale = "false";
  dialog.querySelector("[data-dialog-conflict]").hidden = true;
  setBusy(busy);
  dialog.showModal();
  dialog.dataset.inputSnapshot=dialogSnapshot(dialog);
  lockPage(true);
}
function restoreDialogFocus(target) {
  if (target && !target.isConnected) {
    const taskId = target.closest("[data-task]")?.dataset.task;
    const action = target.dataset.action;
    if (taskId && action)
      target = root.querySelector(
        `[data-task="${CSS.escape(taskId)}"] [data-action="${CSS.escape(action)}"]`,
      );
    else if (target.dataset.deadline)
      target = root.querySelector(
        `[data-deadline="${CSS.escape(target.dataset.deadline)}"]`,
      );
  }
  if (target && !target.disabled && target.getClientRects().length)
    target.focus();
}
function closeDialog(dialog, fromBack = false) {
  if (!dialog.open || busy) return;
  if((blocked||dialogDirty(dialog))&&!confirm("未保存または保存結果未確認の入力を破棄しますか？"))return;
  dialogEpoch++;
  dialog.close();
  const target = dialog.returnFocus;
  if (target?.disabled) pendingFocusRestore = { target, epoch: dialogEpoch };
  else restoreDialogFocus(target);
  lockPage(false);
  if(dialog.id==="todo-native-detail"&&routeId){approvedClose=blocked;navigate("/todo/");}
}
for (const dialog of root.querySelectorAll("dialog")) {
  const conflict = document.createElement("div");
  conflict.dataset.dialogConflict = "";
  conflict.hidden = true;
  conflict.innerHTML =
    '<p role="alert">別の更新があるか、保存結果を確認できません。古い内容で上書きしないよう編集を止めました。</p><button type="button" data-recovery-safe data-inspect-dialog>最新の保存内容を確認</button><button type="button" data-recovery-safe data-export-dialog>入力をダウンロード</button><pre data-inspection hidden></pre><button type="button" data-dialog-reload>最新の内容を読み直す（入力を破棄）</button>';
  dialog.prepend(conflict);
  conflict.querySelector("[data-inspect-dialog]").onclick=()=>inspect(conflict.querySelector("pre"));
  conflict.querySelector("[data-export-dialog]").onclick=()=>recovery.querySelector("[data-export]").click();
  conflict.querySelector("[data-dialog-reload]").onclick = async () => {
    const epoch = dialogEpoch;
    setBusy(true);
    try {
      if(!confirm("入力を破棄して最新の内容を開きますか？"))return;
      await reload();blocked=false;renderBlocked();
      if (!dialog.open || epoch !== dialogEpoch) return;
      if (dialog.id === "todo-native-detail") {
        if (!state.tasks.some((task) => task.id === editId)) {
          dialog.dataset.inputSnapshot=dialogSnapshot(dialog);setBusy(false);closeDialog(dialog);
          message("このタスクは削除されています");
          return;
        }
        openDetail(editId, false);
      } else if (dialog.id === "todo-native-role-dialog") renderRoles();
      else if (dialog.id === "todo-native-categories-dialog") renderCategories();
      dialog.dataset.baseRevision = String(state.revision);
      dialog.dataset.stale = "false";
      conflict.hidden = true;
      dialog.dataset.inputSnapshot=dialogSnapshot(dialog);
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
function openDetail(taskId, show = true) {
  if(show&&taskId!==routeId){navigate("/todo/"+encodeURIComponent(taskId)+"/");return;}
  const id=taskId;
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
  if (show) openDialog($("detail"));
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
  if (ok && epoch === dialogEpoch) { $("detail").dataset.inputSnapshot=dialogSnapshot($("detail"));closeDialog($("detail")); }
};
$("task-delete").onclick = async () => {
  const id = editId,
    epoch = dialogEpoch;
  if (!confirm("このタスクを削除しますか？")) return;
  const next = structuredClone(state);
  next.tasks = next.tasks.filter((t) => t.id !== id);
  if ((await save(next)) && epoch === dialogEpoch) {$("detail").dataset.inputSnapshot=dialogSnapshot($("detail"));closeDialog($("detail"));}
};
$("quick-title").onkeydown = (e) => {
  if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) e.preventDefault();
};
$("capture").onsubmit = async (e) => {
  e.preventDefault();
  if (busy) return;
  const name = $("quick-title").value.trim(),
    captureBase = today(),
    plannedDay = $("capture-day").value === "" ? null : offset(captureBase, Number($("capture-day").value));
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
    createdAt: captureBase,
    plannedDay,
    status: "pending",
  });
  if (await save(next, plannedDay === null ? "インボックスに追加しました" : `${plannedDay} の予定に追加しました（締切なし）`)) {
    $("quick-title").value = "";
    remembered.role=remembered.category="";
  $("task-search").value = $("role-filter").value = $("category-filter").value = "";
    render();
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
  if (button.dataset.action === "plan-today") {
    const next = structuredClone(state);
    next.tasks.find((t) => t.id === id).plannedDay = today();
    await save(next, "今日の予定に移しました。締切は変更していません");
    root.querySelector(`[data-task="${CSS.escape(id)}"] [data-action="detail"]`)?.focus();
  }
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
$("task-search").oninput = render;
$("clear-filters").onclick = () => {
  remembered.role=remembered.category="";
  $("task-search").value = $("role-filter").value = $("category-filter").value = "";
  render();
  $("task-search").focus();
};
$("role-filter").onchange = ()=>{remembered.role=$("role-filter").value;render();};
$("category-filter").onchange = ()=>{remembered.category=$("category-filter").value;render();};
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
    $("role-dialog").dataset.inputSnapshot=dialogSnapshot($("role-dialog"));
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
  if ((await save(next)) && epoch === dialogEpoch) {renderRoles();$("role-dialog").dataset.inputSnapshot=dialogSnapshot($("role-dialog"));}
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
    $("categories-dialog").dataset.inputSnapshot=dialogSnapshot($("categories-dialog"));
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
  if ((await save(next)) && epoch === dialogEpoch) {renderCategories();$("categories-dialog").dataset.inputSnapshot=dialogSnapshot($("categories-dialog"));}
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
  if (busy || blocked) return false;
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
    if(!result||typeof result.task?.id!=="string"||result.request_id!==args.request_id||result.plannedDay!==offset(args.base_day,args.offset_days))throw Error("複製の保存応答を確認できません");
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
    if(alive)setBusy(false);
  }
}
function startClone(id, days, base, deadline = null) {
  if (busy || blocked) return Promise.resolve(false);
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
  if (ok && epoch === dialogEpoch) {$("clone-dialog").dataset.inputSnapshot=dialogSnapshot($("clone-dialog"));closeDialog($("clone-dialog"));}
};

const recovery=root.querySelector('[data-todo-reconcile]');
async function inspect(pre){if(busy)return;setBusy(true);try{const latest=await api();pre.hidden=false;pre.textContent=JSON.stringify(latest,null,2);message('最新の保存内容を表示しました。入力は保持しています。自動再送しません。');}catch(e){if(alive)message('最新の保存内容を取得できませんでした。');}finally{if(alive)setBusy(false);}}
recovery.querySelector('[data-inspect]').onclick=()=>inspect(recovery.querySelector('pre'));
recovery.querySelector('[data-reset]').onclick=async()=>{if(busy||!confirm('入力を破棄して最新の内容を開きますか？'))return;setBusy(true);try{await reload();blocked=false;for(const dialog of root.querySelectorAll('dialog[open]')){if(dialog.id==='todo-native-detail'){if(state.tasks.some(t=>t.id===editId))openDetail(editId,false);else{dialog.dataset.inputSnapshot=dialogSnapshot(dialog);setBusy(false);closeDialog(dialog);}}else if(dialog.id==='todo-native-role-dialog')renderRoles();else if(dialog.id==='todo-native-categories-dialog')renderCategories();dialog.dataset.inputSnapshot=dialogSnapshot(dialog);dialog.dataset.baseRevision=String(state.revision);dialog.dataset.stale='false';dialog.querySelector('[data-dialog-conflict]').hidden=true;}renderBlocked();message('最新の内容を開きました。');}catch(e){if(alive)message('最新の内容を取得できませんでした。入力は保持しています。');}finally{if(alive)setBusy(false);}};
recovery.querySelector('[data-export]').onclick=()=>{const value={revision:state?.revision,state,forms:[...root.querySelectorAll('form')].map(form=>({id:form.id,values:[...form.querySelectorAll("input,textarea,select")].map(input=>[input.name||input.id,input.type==="checkbox"?input.checked:input.value])})),checklist};const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='works-todo-unsaved.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
async function initial(){setBusy(false);try{await reload();if(routeId){if(state.tasks.some(t=>t.id===routeId))openDetail(routeId);else message('このタスクは削除されたか、見つかりません。');}}catch(e){if(!alive)return;message('読み込みに失敗しました。');const button=document.createElement('button');button.textContent='再試行';button.dataset.loadRetry='';button.onclick=()=>{button.remove();initial();};$('notice').append(button);}finally{if(alive)setBusy(false);}}
initial();
return {get dirty(){return busy||blocked||dirty();},canLeave(){if(approvedClose&&!busy){approvedClose=false;return true;}return !busy&&(!(blocked||dirty())||confirm('未保存または保存結果未確認の入力を破棄して移動しますか？'));},unmount(){alive=false;lifecycle.abort();for(const d of root.querySelectorAll('dialog[open]'))d.close();lockPage(false);root.replaceChildren();state=null;context.metrics.unmounts++;}};
}
