import {
  ancestry,
  addDays,
  defaults,
  isInbox,
  palette,
  parseQuick,
  priorityOf,
  projectPath,
  reviewItems,
  sortTasks,
  statusOf,
} from "./model.mjs?v=2";
export { createPlanner };
function createPlanner({
  $,
  esc,
  state,
  save,
  api,
  render,
  group,
  openDialog,
  closeDialog,
  openDetail,
  today,
  message,
  syncShortcuts,
}) {
  const views = {
    today: "今日",
    inbox: "インボックス",
    upcoming: "近日予定",
    all: "すべてのタスク",
    review: "週次レビュー",
    done: "完了履歴",
  };
  const icons = {
    today: "☀",
    inbox: "▤",
    upcoming: "▦",
    all: "☷",
    review: "↻",
    done: "✓",
  };
  const stages = ["未整理", "連絡待ち", "停滞案件"];
  let view = "today",
    organizer = "projects",
    chosenColor = "blue",
    source,
    captureParent,
    dragging = [];
  let selectedDay = null;
  const collapsedProjects = new Set();
  const fullDate = new Intl.DateTimeFormat("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "UTC",
  });
  function setBrowse(open) {
    $("mobile-nav").setAttribute("aria-expanded", String(open));
    $("planner-menu").classList.toggle("is-open", open);
    $("app").classList.toggle("browsing", open);
  }
  function setDisplay(open) {
    $("display-panel").hidden = !open;
    $("display-button").setAttribute("aria-expanded", String(open));
  }
  const s = () => state(),
    p = () => ({ ...defaults(), ...s().planner });
  const value = (id) => $(id).value;
  const option = (id, name) =>
    `<option value="${esc(id)}">${esc(name)}</option>`;
  const dot = (color) =>
    `<i class="project-dot" style="--dot:${palette[color]?.[1] || palette.slate[1]}" aria-hidden="true"></i>`;
  const matchProject = (t, id) =>
    ancestry(p().projects, t.plan?.project).some((i) => i.id === id);
  const params = new URLSearchParams(location.hash.slice(1));
  if (
    ["lesson", "student"].includes(params.get("kind")) &&
    params.get("name")
  ) {
    source = Object.fromEntries(
      ["kind", "name", "calendar", "event", "day", "group"].map((k) => [
        k,
        params.get(k) || "",
      ]),
    );
  }
  function setView(id) {
    view = id;
    setBrowse(false);
    if (view === "upcoming") selectedDay ||= today();
    try {
      $("task-sort").value =
        localStorage.getItem("works-todo-sort:" + view) || "manual";
    } catch {}
    render();
  }
  function meta(task) {
    const a = task.plan || {},
      project = p().projects.find((i) => i.id === a.project);
    return (
      (project
        ? `<span class="meta-project">${dot(project.color)}${esc(projectPath(p().projects, a.project))}</span>`
        : "") +
      (a.section ? `<span>${esc(a.section)}</span>` : "") +
      (a.labels || [])
        .map((id) => p().labels.find((l) => l.id === id))
        .filter(Boolean)
        .map(
          (l) =>
            `<button class="tag-chip" data-label="${esc(l.id)}" title="ラベルで絞り込む">${dot(l.color)}${esc(l.name)}</button>`,
        )
        .join("") +
      (priorityOf(task) < 4
        ? `<span class="badge">P${priorityOf(task)}</span>`
        : "") +
      (a.time ? `<span>${esc(a.time)}</span>` : "") +
      (a.repeat ? `<span title="繰り返し">↻ ${a.repeat.days}日</span>` : "") +
      (a.source ? `<span>↗ ${esc(a.source.name)}</span>` : "") +
      (a.parent
        ? `<span>親：${esc(s().tasks.find((t) => t.id === a.parent)?.name || "")}</span>`
        : "")
    );
  }
  function navButton(id, name, mark, count) {
    return `<button type="button" data-view="${esc(id)}" ${view === id ? 'aria-current="page"' : ""}>${mark}<span>${esc(name)}</span>${count !== undefined ? `<small>${count}</small>` : ""}</button>`;
  }
  function navbar() {
    const data = p(),
      projectName = projectPath(data.projects, view.slice(8));
    const title =
      views[view] ||
      (view.startsWith("project:")
        ? projectName
        : [...data.labels, ...data.filters].find(
            (i) => i.id === view.split(":")[1],
          )?.name);
    $("view-title").textContent = view === "today" ? "今日のタスク" : title || "タスク";
    $("edit-view").hidden = !view.includes(":");
    for (const button of document.querySelectorAll(
      ".bottom-tabs [data-view]",
    )) {
      if (button.dataset.view === view)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    $("views").innerHTML = Object.entries(views)
      .map(([id, name]) =>
        navButton(id, name, `<b aria-hidden="true">${icons[id]}</b>`),
      )
      .join("");
    const children = new Map();
    for (const project of data.projects) {
      const parent = project.parent || null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(project);
    }
    const tree = [],
      stack = [...(children.get(null) || [])].reverse();
    while (stack.length) {
      const item = stack.pop();
      tree.push(item);
      if (collapsedProjects.has(item.id)) continue;
      for (const child of [...(children.get(item.id) || [])].reverse())
        stack.push(child);
    }
    $("projects").innerHTML = tree
      .map(
        (i) =>
          `<div style="--level:${Math.min(4, ancestry(data.projects, i.id).length - 1)}">${navButton("project:" + i.id, i.name, dot(i.color))}
          ${children.has(i.id) ? `<button class="branch-toggle" aria-label="${esc(i.name)}の下位プロジェクト" aria-expanded="${!collapsedProjects.has(i.id)}" data-branch="${esc(i.id)}">${collapsedProjects.has(i.id) ? "›" : "⌄"}</button>` : ""}</div>`,
      )
      .join("");
    $("labels").innerHTML = data.labels
      .map((i) => navButton("label:" + i.id, i.name, dot(i.color)))
      .join("");
    $("saved-filters").innerHTML = data.filters
      .map((i) => navButton("filter:" + i.id, i.name, "⌕"))
      .join("");
    $("calendar-sync").checked = data.calendar;
  }
  function applyFilter(t, f, day) {
    return (
      (!f.query ||
        [t.name, t.memo, t.reusableDescription]
          .join(" ")
          .toLocaleLowerCase()
          .includes(f.query.toLocaleLowerCase())) &&
      (!f.project || matchProject(t, f.project)) &&
      (!f.label || t.plan?.labels?.includes(f.label)) &&
      (!f.status || statusOf(t) === f.status) &&
      (!f.priority || priorityOf(t) === f.priority) &&
      (!f.due ||
        (t.deadline && t.deadline <= addDays(day, 7) && statusOf(t) !== "done"))
    );
  }
  function renderList(list, mode, day) {
    for (const instance of dragging) instance.destroy();
    dragging = [];
    navbar();
    $("review-controls").replaceChildren();
    const agenda = view === "upcoming" && mode === "list";
    $("week-picker").hidden = !agenda;
    const focusDay = selectedDay || day;
    const monday = addDays(
      focusDay,
      -((new Date(focusDay).getUTCDay() + 6) % 7),
    );
    const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    if (agenda) {
      $("week-picker").innerHTML =
        `<div class="week-tools"><button data-week="-7" aria-label="前の週">‹</button><strong>${Number(focusDay.slice(0, 4))}年${Number(focusDay.slice(5, 7))}月</strong><button data-week="7" aria-label="次の週">›</button><button data-day="${day}">今日へ</button></div><div class="week-days">${week.map((date, i) => `<button data-day="${date}" aria-label="${fullDate.format(new Date(date))}" aria-pressed="${date === focusDay}"><small>${"月火水木金土日"[i]}</small><b>${Number(date.slice(8))}</b></button>`).join("")}</div>`;
    }
    const visible = list.filter((t) => {
      const active = statusOf(t) !== "done";
      if (view === "done") return !active;
      if (view === "today")
        return (
          active &&
          ((t.plannedDay && t.plannedDay <= day) ||
            (t.deadline && t.deadline <= day))
        );
      if (view === "inbox") return isInbox(t);
      if (view === "upcoming")
        return (
          active && (agenda ? week.includes(t.plannedDay) : t.plannedDay >= day)
        );
      if (view.startsWith("project:"))
        return active && matchProject(t, view.slice(8));
      if (view.startsWith("label:"))
        return active && t.plan?.labels?.includes(view.slice(6));
      if (view.startsWith("filter:"))
        return applyFilter(
          t,
          p().filters.find((f) => f.id === view.slice(7)) || {},
          day,
        );
      return true;
    });
    let sorted = sortTasks(visible, value("task-sort"));
    if (view === "review") {
      const review = p().review || { step: 0 },
        step = review.step;
      const items = reviewItems(s().tasks, p().projects, step, day);
      $("review-controls").innerHTML =
        `<nav aria-label="レビュー手順">${stages.map((n, i) => `<button data-stage="${i}" ${i === step ? 'aria-current="step"' : ""}>${i + 1}. ${n}</button>`).join("")}</nav><p>${["予定日やプロジェクトを決めます。", "返事の確認や次の連絡日を決めます。", "7日間動きがないプロジェクトを開き、次の行動を決めます。"][step]}</p><button id="advance-review">${step === 2 ? "レビューを完了" : "次の項目へ"}</button>${review.last ? `<small> 前回完了 ${esc(review.last)}</small>` : ""}`;
      $("review-controls").onclick = async (e) => {
        const stage = e.target.closest("[data-stage]");
        if (!stage && e.target.id !== "advance-review") return;
        const next = structuredClone(s());
        next.planner = {
          ...p(),
          review: {
            last: !stage && step === 2 ? day : review.last || null,
            step: stage ? Number(stage.dataset.stage) : (step + 1) % 3,
          },
        };
        await save(
          next,
          !stage && step === 2
            ? "週次レビューを完了しました"
            : "確認項目を切り替えました",
        );
      };
      if (step === 2) {
        $("tasks").innerHTML = items.length
          ? items
              .map(
                (i) =>
                  `<button class="review-project" data-view="project:${esc(i.id)}">${dot(i.color)}${esc(projectPath(p().projects, i.id))} を開く</button>`,
              )
              .join("")
          : '<p class="empty">停滞している案件はありません。</p>';
        $("task-count").textContent = items.length + "件";
        return;
      }
      sorted = sortTasks(items, value("task-sort"));
    }
    $("task-count").textContent =
      (view === "today" ? "未完了 " : "") +
      sorted.length +
      "件" +
      ($("clear-filters").hidden ? "" : " · 絞り込み中");
    const groups = new Map();
    for (const t of sorted) {
      let key = "";
      if (mode === "board")
        key = {
          pending: "未着手",
          doing: "進行中",
          waiting: "連絡待ち",
          done: "完了",
        }[statusOf(t)];
      else if (view === "upcoming") key = t.plannedDay;
      else if (view.startsWith("project:"))
        key = t.plan?.section || "セクションなし";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    let blocks = [...groups];
    if (mode === "board")
      blocks = ["未着手", "進行中", "連絡待ち", "完了"].map((k) => [
        k,
        groups.get(k) || [],
      ]);
    else if (agenda)
      blocks = week
        .filter(
          (date) =>
            date >= (week.includes(day) && focusDay >= day ? day : monday),
        )
        .map((date) => [date, groups.get(date) || []]);
    $("tasks").innerHTML =
      sorted.length || agenda
        ? `<div class="${mode === "board" ? "board" : "planner-list"}">${blocks.map(([key, items]) => (agenda ? group(fullDate.format(new Date(key)) + (key === day ? " · 今日" : key === addDays(day, 1) ? " · 明日" : ""), items, key) : group(key, items, null, view === "today" && mode === "list" ? day : null))).join("")}</div>`
        : `<p class="empty">${value("task-search").trim() || value("role-filter") || value("category-filter") ? "条件に合うタスクがありません。" : view === "today" ? "今日の予定と期限超過のタスクはありません。" : view === "review" ? "この項目はすべて整理できています。" : "該当するタスクはありません。"}</p>`;
    if (agenda) {
      const nextDate = list
        .filter((t) => statusOf(t) !== "done" && t.plannedDay > week[6])
        .map((t) => t.plannedDay)
        .sort()[0];
      if (nextDate)
        $("tasks").insertAdjacentHTML(
          "beforeend",
          `<button class="next-plan" data-day="${esc(nextDate)}">次の予定　${fullDate.format(new Date(nextDate))}　›</button>`,
        );
    }
    if (view === "today" && mode === "list") {
      const start = Date.parse(day + "T00:00:00+09:00");
      const completed = list.filter((task) => {
        if (statusOf(task) !== "done") return false;
        if (task.completedAt === day) return true;
        const stamp = Date.parse(task.completedAt);
        return stamp >= start && stamp < start + 86400000;
      });
      if (completed.length)
        $("tasks").insertAdjacentHTML(
          "beforeend",
          `<details class="completed-today"><summary>完了済み　${completed.length}件</summary>${group("", completed, null, day)}</details>`,
        );
    }
    if (value("task-sort") === "manual" && window.Sortable) {
      for (const el of $("tasks").querySelectorAll(".task-rows"))
        dragging.push(
          window.Sortable.create(el, {
            handle: ".drag-grip",
            animation: 100,
            draggable: "[data-task]",
            onEnd: (e) => {
              const rows = [...el.querySelectorAll("[data-task]")].map(
                (n) => n.dataset.task,
              );
              if (e.oldIndex !== e.newIndex) reorder(rows);
            },
          }),
        );
    }
  }
  async function reorder(ids) {
    const next = structuredClone(s()),
      map = new Map(next.tasks.map((t) => [t.id, t])),
      selected = new Set(ids);
    let index = 0;
    next.tasks = next.tasks.map((t) =>
      selected.has(t.id) ? map.get(ids[index++]) : t,
    );
    await save(next, "順序を保存しました");
  }
  function changeOrder(button, direction) {
    const ids = [
      ...button.closest(".task-rows").querySelectorAll("[data-task]"),
    ].map((n) => n.dataset.task);
    const index = ids.indexOf(button.closest("[data-task]").dataset.task),
      target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return reorder(ids);
  }
  const parse = () =>
    parseQuick(value("quick-title"), today(), value("capture-day") || today());
  let explicitCaptureDay = false;
  function preview() {
    const q = parse();
    refreshChips(q);
    // Day, time and project now show on the chips; keep the rest as a hint line.
    $("quick-preview").textContent = [
      q.repeat && `↻ ${q.repeat.days}日`,
      ...q.labels.map((n) => "@" + n),
      q.priority && "P" + q.priority,
    ]
      .filter(Boolean)
      .join("　");
    $("capture-source").textContent = source
      ? "紐付け元　" + source.name
      : captureParent
        ? "親タスク　" +
          (s().tasks.find((t) => t.id === captureParent)?.name || "")
        : "";
  }
  // ---- Quick capture: chips, "#" project suggestions, continuous entry ----
  const weekday = (day) => "日月火水木金土"[new Date(day + "T00:00:00Z").getUTCDay()];
  function dayText(day) {
    if (!day) return "日付なし";
    if (day === today()) return "今日";
    if (day === addDays(today(), 1)) return "明日";
    const [, m, d] = day.split("-");
    return `${Number(m)}/${Number(d)}(${weekday(day)})`;
  }
  function refreshChips(q = parse()) {
    const select = $("capture-project");
    const chosen = select.selectedOptions[0]?.textContent || "インボックス";
    $("capture-project-label").textContent = q.project ? q.project.split("/").join(" / ") : chosen;
    $("capture-project-chip").classList.toggle("is-set", Boolean(q.project || select.value));
    const day = explicitCaptureDay || !q.day ? value("capture-day") || q.day : q.day;
    $("capture-day-label").textContent = dayText(day || null) + (q.time ? " " + q.time : "");
    $("capture-day-chip").classList.toggle("is-set", Boolean(day));
  }
  function closePicker() {
    $("capture-picker").hidden = true;
    $("capture-picker").replaceChildren();
    $("capture-project-chip").setAttribute("aria-expanded", "false");
    $("capture-day-chip").setAttribute("aria-expanded", "false");
  }
  function pickerButton(label, onPick, pressed = false) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "capture-pick";
    b.textContent = label;
    b.setAttribute("aria-pressed", String(pressed));
    b.onclick = () => { onPick(); closePicker(); refreshChips(); $("quick-title").focus(); };
    return b;
  }
  function setCaptureDay(day) {
    $("capture-day").value = day || "";
    $("capture-day").dispatchEvent(new Event("input", { bubbles: true }));
  }
  function openDayPicker() {
    const picker = $("capture-picker");
    if (!picker.hidden && $("capture-day-chip").getAttribute("aria-expanded") === "true") return closePicker();
    closePicker();
    const current = value("capture-day");
    const nextMonday = addDays(today(), ((8 - new Date(today() + "T00:00:00Z").getUTCDay()) % 7) || 7);
    const list = document.createElement("div");
    list.className = "capture-pick-list";
    list.append(
      pickerButton("今日", () => setCaptureDay(today()), current === today()),
      pickerButton("明日", () => setCaptureDay(addDays(today(), 1)), current === addDays(today(), 1)),
      pickerButton("来週 " + dayText(nextMonday), () => setCaptureDay(nextMonday), current === nextMonday),
      pickerButton("日付なし", () => setCaptureDay(""), !current),
    );
    const other = document.createElement("label");
    other.className = "capture-pick-date";
    other.textContent = "日付を選ぶ";
    const input = document.createElement("input");
    input.type = "date";
    input.value = current;
    input.onchange = () => { setCaptureDay(input.value); closePicker(); refreshChips(); $("quick-title").focus(); };
    other.append(input);
    picker.append(list, other);
    picker.hidden = false;
    $("capture-day-chip").setAttribute("aria-expanded", "true");
  }
  function projectChoices(query = "") {
    const needle = query.normalize("NFKC").toLocaleLowerCase("ja");
    return p().projects
      .filter((item) => !item.archived)
      .map((item) => ({ id: item.id, path: projectPath(p().projects, item.id) }))
      .filter((item) => !needle || item.path.normalize("NFKC").toLocaleLowerCase("ja").includes(needle))
      .slice(0, 8);
  }
  function chooseProject(id) {
    $("capture-project").value = id || "";
    refreshChips();
  }
  function openProjectPicker() {
    const picker = $("capture-picker");
    if (!picker.hidden && $("capture-project-chip").getAttribute("aria-expanded") === "true") return closePicker();
    closePicker();
    const list = document.createElement("div");
    list.className = "capture-pick-list";
    list.setAttribute("role", "listbox");
    list.append(pickerButton("インボックス", () => chooseProject(""), !value("capture-project")));
    for (const item of projectChoices()) list.append(pickerButton("# " + item.path, () => chooseProject(item.id), value("capture-project") === item.id));
    picker.append(list);
    picker.hidden = false;
    $("capture-project-chip").setAttribute("aria-expanded", "true");
  }
  // "#" at the caret lists projects; choosing one removes the typed token and sets the project.
  let suggestIndex = 0;
  function hashToken() {
    const input = $("quick-title");
    const before = input.value.slice(0, input.selectionStart ?? input.value.length);
    const match = /(^|\s)#([^\s#]*)$/u.exec(before);
    return match ? { start: before.length - match[2].length - 1, end: before.length, query: match[2] } : null;
  }
  function hideSuggest() {
    $("capture-suggest").hidden = true;
    $("capture-suggest").replaceChildren();
    $("quick-title").setAttribute("aria-expanded", "false");
    $("quick-title").removeAttribute("aria-activedescendant");
  }
  function applySuggestion(id) {
    const token = hashToken();
    const input = $("quick-title");
    if (token) {
      input.value = (input.value.slice(0, token.start) + input.value.slice(token.end)).replace(/\s{2,}/gu, " ").trimStart();
      input.setSelectionRange(token.start, token.start);
    }
    chooseProject(id);
    hideSuggest();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
  function renderSuggest() {
    const token = hashToken();
    const items = token ? projectChoices(token.query) : [];
    if (!token || !items.length) return hideSuggest();
    suggestIndex = Math.min(suggestIndex, items.length - 1);
    $("capture-suggest").replaceChildren(...items.map((item, i) => {
      const li = document.createElement("li");
      li.id = "capture-suggest-" + i;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === suggestIndex));
      li.dataset.projectId = item.id;
      li.textContent = "# " + item.path;
      li.onpointerdown = (e) => { e.preventDefault(); applySuggestion(item.id); };
      return li;
    }));
    $("capture-suggest").hidden = false;
    $("quick-title").setAttribute("aria-expanded", "true");
    $("quick-title").setAttribute("aria-activedescendant", "capture-suggest-" + suggestIndex);
  }
  $("quick-title").addEventListener("input", () => { suggestIndex = 0; renderSuggest(); });
  $("quick-title").addEventListener("keydown", (e) => {
    if ($("capture-suggest").hidden || e.isComposing || e.keyCode === 229) return;
    const options = [...$("capture-suggest").children];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      suggestIndex = (suggestIndex + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
      renderSuggest();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      applySuggestion(options[suggestIndex].dataset.projectId);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      hideSuggest();
    }
  });
  $("quick-title").addEventListener("blur", () => setTimeout(hideSuggest, 120));
  $("capture-project-chip").onclick = openProjectPicker;
  $("capture-day-chip").onclick = openDayPicker;
  $("capture-project").addEventListener("change", () => refreshChips());
  $("capture-more").onclick = () => {
    const open = !$("capture-extra").classList.contains("is-open");
    $("capture-extra").classList.toggle("is-open", open);
    $("capture-more").setAttribute("aria-expanded", String(open));
  };
  $("capture-sheet").addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("capture-picker").hidden) { e.preventDefault(); closePicker(); }
  });
  let lastCapturedView = null;
  $("capture-jump").onclick = () => {
    const target = lastCapturedView;
    closeDialog($("capture-sheet"));
    if (target) setView(target);
  };
  function openCapture(date, parentId = null, replaceDialog = false) {
    captureParent = parentId;
    explicitCaptureDay = false;
    const projects = p().projects;
    const parent = s().tasks.find((t) => t.id === parentId);
    $("capture-project").innerHTML =
      option("", "インボックス") +
      projects
        .map((item) => option(item.id, projectPath(projects, item.id)))
        .join("");
    $("capture-project").value =
      parent?.plan?.project ||
      (view.startsWith("project:") ? view.slice(8) : "");
    $("capture-day").value = date ?? (view === "today" ? today() : "");
    $("capture-error").textContent = "";
    $("capture-added").hidden = true;
    closePicker();
    hideSuggest();
    syncShortcuts($("capture"), $("capture-day"));
    preview();
    openDialog($("capture-sheet"), replaceDialog);
    $("quick-title").focus();
  }
  function capture(next, task) {
    const q = parse();
    if (!q.name) throw Error("タスク名を入力してください");
    const data = (next.planner = { ...defaults(), ...next.planner });
    const mk = (name) => ({
      id: crypto.randomUUID(),
      name,
      color: "blue",
      createdDay: today(),
    });
    let project = value("capture-project") || null;
    if (q.project) {
      let parent = null;
      const names = q.project.split("/").filter(Boolean);
      for (const name of names) {
        const found = data.projects.filter(
          (i) => i.name === name && (i.parent || null) === parent,
        );
        let item = found[0];
        if (names.length === 1 && !item) {
          const candidates = data.projects.filter((i) => i.name === name);
          if (candidates.length > 1)
            throw Error(
              "同名のプロジェクトがあります。#勤務先/案件名 で指定してください",
            );
          item = candidates[0];
        }
        if (!item) {
          item = { ...mk(name), parent };
          data.projects.push(item);
        }
        parent = item.id;
      }
      project = parent;
    }
    const labels = new Set(view.startsWith("label:") ? [view.slice(6)] : []);
    for (const name of [
      ...q.labels,
      ...value("capture-tags").trim().split(/\s+/).filter(Boolean),
    ]) {
      let item = data.labels.find((i) => i.name === name);
      if (!item) {
        item = mk(name);
        data.labels.push(item);
      }
      labels.add(item.id);
    }
    task.name = q.name;
    task.plannedDay = explicitCaptureDay ? task.plannedDay : q.day || task.plannedDay;
    task.deadline = value("capture-deadline") || null;
    task.priority = q.priority && q.priority < 4 ? 4 - q.priority : null;
    task.plan = {
      project,
      labels: [...labels],
      parent: captureParent || null,
      priority: q.priority || 4,
      reminder: value("capture-reminder") || null,
      repeat: q.repeat,
      time: q.time,
      source: source || null,
    };
  }
  function clearCapture() {
    source = null;
    captureParent = null;
    $("capture").reset();
    $("capture-details").open = false;
    preview();
  }
  // Keep the sheet open for the next task; say where it went and offer a jump there.
  let addedTimer;
  function captured(task) {
    if (task.plannedDay && task.plannedDay > today())
      selectedDay = task.plannedDay;
    lastCapturedView = task.plan?.project
      ? "project:" + task.plan.project
      : !task.plannedDay
        ? task.plan?.parent
          ? "all"
          : "inbox"
        : task.plannedDay <= today()
          ? "today"
          : "upcoming";
    const where = task.plan?.project
      ? projectPath(p().projects, task.plan.project)
      : task.plannedDay
        ? dayText(task.plannedDay) + "の予定"
        : task.plan?.parent ? "サブタスク" : "インボックス";
    $("capture-added-text").textContent = `「${task.name}」を${where}に追加しました`;
    $("capture-added").hidden = false;
    clearTimeout(addedTimer);
    addedTimer = setTimeout(() => { $("capture-added").hidden = true; }, 8000);
    source = null;
    captureParent = null;
    $("capture-memo").value = "";
    $("capture-tags").value = "";
    $("capture-deadline").value = "";
    $("capture-reminder").value = "";
    $("quick-title").value = "";
    $("quick-title").dispatchEvent(new Event("input", { bubbles: true }));
    render();
    preview();
    $("quick-title").focus();
  }
  function fillDetail(t) {
    const d = p(),
      a = t.plan || {};
    $("task-project").innerHTML =
      option("", "なし") +
      d.projects
        .map((i) => option(i.id, projectPath(d.projects, i.id)))
        .join("");
    const children = new Map();
    for (const item of s().tasks) {
      if (!item.plan?.parent) continue;
      const parent = item.plan.parent;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(item.id);
    }
    const excluded = new Set([t.id]);
    for (const parent of excluded)
      for (const child of children.get(parent) || []) excluded.add(child);
    $("task-parent").innerHTML =
      option("", "なし") +
      s()
        .tasks.filter((i) => !excluded.has(i.id))
        .map((i) => option(i.id, i.name))
        .join("");
    for (const [id, val] of Object.entries({
      "task-project": a.project,
      "task-parent": a.parent,
      "task-time": a.time,
      "task-duration": a.duration,
      "task-section": a.section,
      "task-priority": priorityOf(t),
      "task-reminder": a.reminder,
      "task-repeat": a.repeat?.mode,
      "task-interval": a.repeat?.days || 7,
    }))
      $(id).value = val ?? "";
    $("interval-field").hidden = !a.repeat;
    $("known-sections").innerHTML = [
      ...new Set(
        s()
          .tasks.map((i) => i.plan?.section)
          .filter(Boolean),
      ),
    ]
      .map((n) => option(n, n))
      .join("");
    $("task-labels").innerHTML = d.labels.length
      ? "ラベル " +
        d.labels
          .map(
            (l) =>
              `<label><input type="checkbox" value="${esc(l.id)}" ${(a.labels || []).includes(l.id) ? "checked" : ""}>${dot(l.color)}${esc(l.name)}</label>`,
          )
          .join("")
      : "";
    const origin = a.source;
    $("origin-link").replaceChildren();
    if (origin) {
      const link = document.createElement("a"),
        q = new URLSearchParams();
      if (origin.kind === "lesson") {
        q.set("record_date", origin.day);
        q.set("todo_event", origin.event);
        q.set("todo_calendar", origin.calendar);
      } else {
        q.set("todo_student", origin.name);
        if (origin.group) q.set("todo_group", origin.group);
      }
      link.href = "/tutor/?" + q;
      link.textContent =
        "↗ " +
        origin.name +
        "の" +
        (origin.kind === "lesson" ? "授業記録" : "生徒情報");
      $("origin-link").append(link);
    }
    $("child-tasks").innerHTML =
      s()
        .tasks.filter((i) => i.plan?.parent === t.id)
        .map(
          (i) =>
            `<span>${statusOf(i) === "done" ? "✓" : "○"} ${esc(i.name)}</span>`,
        )
        .join("") +
      `<button type="button" id="add-child">＋ サブタスク</button>`;
    $("add-child").onclick = () => {
      closeDialog($("detail"), true);
      openCapture(null, t.id, true);
    };
  }
  function readDetail(t) {
    const mode = value("task-repeat"),
      time = value("task-time");
    if ((mode || time) && !t.plannedDay)
      throw Error("繰り返し・開始時刻には予定日が必要です");
    const old = t.plan || {};
    let priority = Number(value("task-priority"));
    t.plan = {
      ...old,
      project: value("task-project") || null,
      parent: value("task-parent") || null,
      labels: [...$("task-labels").querySelectorAll(":checked")].map(
        (i) => i.value,
      ),
      section: value("task-section").trim(),
      time: time || null,
      duration: value("task-duration") ? Number(value("task-duration")) : null,
      reminder: value("task-reminder") || null,
      repeat: mode ? { mode, days: Number(value("task-interval")) } : null,
      priority,
    };
    t.priority = priority === 4 ? null : 4 - priority;
  }
  function fillManager() {
    const d = p(),
      items = d[organizer],
      id = value("organizer-item"),
      item = items.find((i) => i.id === id) || {};
    $("organizer-name").value = item.name || "";
    $("org-parent-field").hidden = organizer !== "projects";
    $("org-colors").hidden = organizer === "filters";
    $("filter-fields").hidden = organizer !== "filters";
    $("organizer-parent").innerHTML =
      option("", "最上位") +
      d.projects
        .filter((i) => !ancestry(d.projects, i.id).some((n) => n.id === id))
        .map((i) => option(i.id, projectPath(d.projects, i.id)))
        .join("");
    $("organizer-parent").value =
      item.parent || (!id && view.startsWith("project:") ? view.slice(8) : "");
    chosenColor = item.color || "blue";
    paintColors();
    $("filter-project").innerHTML =
      option("", "すべて") +
      d.projects
        .map((i) => option(i.id, projectPath(d.projects, i.id)))
        .join("");
    $("filter-label").innerHTML =
      option("", "すべて") + d.labels.map((i) => option(i.id, i.name)).join("");
    for (const key of ["query", "project", "label", "status", "priority"])
      $("filter-" + key).value = item[key] || "";
    $("organizer-order").hidden = !item.id;
    $("filter-due").checked = !!item.due;
    $("organizer-delete").hidden = !item.id;
    $("organizer-error").textContent = "";
  }
  function paintColors() {
    $("color-options").innerHTML = Object.entries(palette)
      .map(
        ([key, [name]]) =>
          `<button type="button" data-color="${key}" aria-pressed="${key === chosenColor}">${dot(key)}${name}</button>`,
      )
      .join("");
  }
  function manage(kind, show = true) {
    organizer = kind;
    $("organizer-title").textContent =
      { projects: "プロジェクト", labels: "ラベル", filters: "保存フィルター" }[
        kind
      ] + "を管理";
    $("organizer-item").innerHTML =
      option("", "新規作成") +
      p()
        [kind].map((i) =>
          option(
            i.id,
            kind === "projects" ? projectPath(p().projects, i.id) : i.name,
          ),
        )
        .join("");
    fillManager();
    if (show) openDialog($("organizer"));
  }
  async function moveOrganizer(by) {
    const next = structuredClone(s()),
      items = next.planner[organizer],
      id = value("organizer-item");
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const siblings = items.filter(
      (i) => (i.parent || null) === (item.parent || null),
    );
    const target = siblings[siblings.indexOf(item) + by];
    if (!target) return;
    const from = items.indexOf(item),
      to = items.indexOf(target);
    [items[from], items[to]] = [items[to], items[from]];
    if (await save(next, "表示順を保存しました")) {
      manage(organizer, false);
      $("organizer-item").value = id;
      fillManager();
    }
  }
  $("org-up").onclick = () => moveOrganizer(-1);
  $("org-down").onclick = () => moveOrganizer(1);
  $("organizer-item").onchange = fillManager;
  $("color-options").onclick = (e) => {
    const b = e.target.closest("[data-color]");
    if (b) {
      chosenColor = b.dataset.color;
      paintColors();
    }
  };
  $("organizer-form").onsubmit = async (e) => {
    e.preventDefault();
    const next = structuredClone(s()),
      data = (next.planner = { ...defaults(), ...next.planner }),
      id = value("organizer-item"),
      name = value("organizer-name").trim();
    if (!name) return;
    const items = data[organizer],
      item = items.find((i) => i.id === id) || {
        id: crypto.randomUUID(),
        createdDay: today(),
      };
    const parent =
      organizer === "projects" ? value("organizer-parent") || null : null;
    if (
      items.some(
        (i) => i.id !== id && i.name === name && (i.parent || null) === parent,
      )
    ) {
      $("organizer-error").textContent = "同じ場所に同名の項目があります";
      return;
    }
    item.name = name;
    if (organizer === "filters")
      Object.assign(item, {
        query: value("filter-query").trim(),
        project: value("filter-project"),
        label: value("filter-label"),
        status: value("filter-status"),
        priority: Number(value("filter-priority")) || null,
        due: $("filter-due").checked ? "week" : "",
      });
    else {
      item.color = chosenColor;
      if (organizer === "projects") item.parent = parent;
    }
    if (!id) items.push(item);
    if (await save(next)) closeDialog($("organizer"));
  };
  $("organizer-delete").onclick = async () => {
    const id = value("organizer-item"),
      next = structuredClone(s()),
      data = next.planner,
      items = data[organizer];
    if (!id || !confirm("この分類を削除しますか？所属するタスクは残ります。"))
      return;
    const item = items.find((i) => i.id === id);
    data[organizer] = items.filter((i) => i.id !== id);
    if (organizer === "projects") {
      for (const i of data.projects)
        if (i.parent === id) i.parent = item.parent || null;
      for (const t of next.tasks)
        if (t.plan?.project === id) t.plan.project = item.parent || null;
      for (const f of data.filters)
        if (f.project === id) f.project = item.parent || "";
    } else if (organizer === "labels") {
      for (const t of next.tasks)
        if (t.plan?.labels)
          t.plan.labels = t.plan.labels.filter((l) => l !== id);
      for (const f of data.filters) if (f.label === id) f.label = "";
    }
    if (await save(next)) {
      closeDialog($("organizer"));
      setView("today");
    }
  };
  $("edit-view").onclick = () => {
    const [kind, id] = view.split(":");
    manage({ project: "projects", label: "labels", filter: "filters" }[kind]);
    $("organizer-item").value = id;
    fillManager();
  };
  $("new-project").onclick = () => manage("projects");
  $("new-label").onclick = () => manage("labels");
  $("new-filter").onclick = () => manage("filters");
  $("mobile-nav").onclick = () => {
    setBrowse(!$("planner-menu").classList.contains("is-open"));
    window.scrollTo(0, 0);
  };
  $("display-button").onclick = () => setDisplay($("display-panel").hidden);
  $("sidebar-search").onclick = $("mobile-search").onclick = () => {
    setView("all");
    setDisplay(true);
    $("task-search").focus();
  };
  $("mobile-add").onclick = () =>
    openCapture(view === "upcoming" ? selectedDay : null);
  $("projects").onclick = (e) => {
    const button = e.target.closest("[data-branch]");
    if (!button) return;
    const id = button.dataset.branch;
    if (collapsedProjects.has(id)) collapsedProjects.delete(id);
    else collapsedProjects.add(id);
    navbar();
    $("projects")
      .querySelector(`[data-branch="${CSS.escape(id)}"]`)
      ?.focus();
  };
  $("app").addEventListener("click", (e) => {
    const control = e.target.closest("[data-add-day],[data-day],[data-week]");
    if (control) {
      if (control.dataset.addDay) return openCapture(control.dataset.addDay);
      selectedDay =
        control.dataset.day ||
        addDays(selectedDay || today(), Number(control.dataset.week));
      render();
      const target = document.getElementById("agenda-" + selectedDay);
      if (control.dataset.day && target)
        target.scrollIntoView({ block: "nearest" });
      $("week-picker")
        .querySelector(`.week-days [data-day="${selectedDay}"]`)
        ?.focus({ preventScroll: true });
      return;
    }
    const b = e.target.closest("[data-view],[data-label]");
    if (b) setView(b.dataset.view || "label:" + b.dataset.label);
  });
  $("task-sort").onchange = () => {
    try {
      localStorage.setItem("works-todo-sort:" + view, value("task-sort"));
    } catch {}
    render();
  };
  $("task-repeat").onchange = () => {
    $("interval-field").hidden = !value("task-repeat");
  };
  $("new-task").onclick = () => {
    openCapture(view === "upcoming" ? selectedDay : null);
  };
  document.addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() === "q" &&
      !e.isComposing &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.target.closest("input,textarea,select,[contenteditable],dialog") &&
      !$("app").hidden
    ) {
      e.preventDefault();
      $("new-task").click();
    }
  });
  $("quick-title").addEventListener("input", () => {
    if ($("capture-sheet").dataset.stale !== "true") $("capture-submit").disabled = !value("quick-title").trim();
    preview();
  });
  $("capture-day").addEventListener("input", () => {
    explicitCaptureDay = true;
    preview();
  });
  $("calendar-sync").onchange = async () => {
    const next = structuredClone(s());
    next.planner = { ...p(), calendar: $("calendar-sync").checked };
    await save(next, "カレンダー連携の設定を保存しました");
  };
  $("sync-status").onclick = async () => {
    try {
      const v = await api("/integrations/status");
      $("delivery-state").textContent =
        v.error ||
        (v.lastRun
          ? "最終確認 " +
            new Date(v.lastRun).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })
          : "初回の配信処理を待っています");
    } catch {
      $("delivery-state").textContent = "連携状態を取得できませんでした";
    }
  };
  $("push-settings").onclick = async () => {
    const out = $("delivery-state");
    if (
      !("serviceWorker" in navigator) ||
      !window.PushManager ||
      !window.Notification
    ) {
      out.textContent =
        "iPhoneではWorks ToDoをホーム画面に追加し、そこから開いてください。";
      return;
    }
    try {
      const auth = await Notification.requestPermission();
      if (auth !== "granted") {
        out.textContent =
          "通知を受け取るには、端末の設定で通知を許可してください。";
        return;
      }
      await navigator.serviceWorker.register("/todo/sw.js", {
        scope: "/todo/",
      });
      const reg = await navigator.serviceWorker.ready;
      const key = await api("/integrations/key"),
        bytes = Uint8Array.from(
          atob(key.publicKey.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        );
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        }));
      await api("/integrations/device", {
        method: "POST",
        body: JSON.stringify(sub.toJSON()),
      });
      out.textContent = "この端末への通知を有効にしました。";
    } catch {
      out.textContent =
        "通知を登録できませんでした。ホーム画面のWorksから再試行してください。";
    }
  };
  $("push-disable").onclick = async () => {
    const out = $("delivery-state");
    try {
      const reg = await navigator.serviceWorker?.getRegistration("/todo/");
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await api("/integrations/device", {
          method: "DELETE",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      out.textContent = "この端末の通知を解除しました。";
    } catch {
      out.textContent = "通知を解除できませんでした。再試行してください。";
    }
  };
  function initial() {
    setView("today");
    preview();
    const task = new URLSearchParams(location.search).get("task");
    if (task && s().tasks.some((t) => t.id === task)) openDetail(task);
    else if (source) {
      const sourceUrl = location.href;
      const alreadyOpen = history.state?.todoDialog === "capture-sheet";
      if (!alreadyOpen)
        history.replaceState(
          history.state,
          "",
          location.pathname + location.search,
        );
      openCapture(null, null, alreadyOpen);
      history.replaceState(history.state, "", sourceUrl);
    }
  }
  return {
    initial,
    meta,
    renderList,
    capture,
    clearCapture,
    captured,
    fillDetail,
    readDetail,
    changeOrder,
    refreshManager: () => manage(organizer, false),
  };
}
