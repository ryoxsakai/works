import {
  addDays,
  dayAt,
  defaults,
  nextDay,
  palette,
  statusOf,
  validDay,
  validTime,
} from "../../todo/model.mjs";

const reject = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const text = (s, limit) =>
  typeof s === "string" && s.trim().length > 0 && s.length <= limit;
const array = (a, max) => Array.isArray(a) && a.length <= max;
function registry(items, kind) {
  if (!array(items, 1000)) reject(kind + "の件数が上限を超えています");
  const ids = new Set();
  for (const item of items) {
    if (
      !item ||
      !text(item.id, 120) ||
      !text(item.name, 100) ||
      ids.has(item.id)
    )
      reject(kind + "が不正です");
    ids.add(item.id);
  }
  return ids;
}
function tree(items, parent, kind) {
  const byId = new Map(items.map((t) => [t.id, t])),
    checked = new Set();
  for (const item of items) {
    let node = item;
    const path = new Set();
    while (node && !checked.has(node.id)) {
      if (path.has(node.id)) reject(kind + "を循環させることはできません");
      path.add(node.id);
      const id = parent(node);
      if (id && !byId.has(id)) reject(kind + "の親が見つかりません");
      node = byId.get(id);
    }
    for (const id of path) checked.add(id);
  }
}
function validate(state) {
  const p = state.planner;
  const projects = registry(p.projects, "プロジェクト"),
    labels = registry(p.labels, "ラベル");
  registry(p.filters, "フィルター");
  if (
    [...p.projects, ...p.labels].some((i) => !Object.hasOwn(palette, i.color))
  )
    reject("色を選び直してください");
  tree(p.projects, (i) => i.parent, "プロジェクト");
  if (
    typeof p.calendar !== "boolean" ||
    (p.review &&
      (!Number.isInteger(p.review.step) ||
        p.review.step < 0 ||
        p.review.step > 2 ||
        (p.review.last && !validDay(p.review.last))))
  )
    reject("設定が不正です");
  for (const f of p.filters) {
    if (
      typeof f.query !== "string" ||
      f.query.length > 500 ||
      (f.label && !labels.has(f.label)) ||
      (f.status &&
        !["pending", "doing", "waiting", "done"].includes(f.status)) ||
      (f.due && f.due !== "week") ||
      (f.project && !projects.has(f.project)) ||
      (f.priority && ![1, 2, 3, 4].includes(f.priority))
    )
      reject("絞り込み条件が不正です");
  }
  tree(state.tasks, (t) => t.plan?.parent, "タスク");
  for (const task of state.tasks) {
    const a = task.plan;
    if (!a) continue;
    if (
      (a.project && !projects.has(a.project)) ||
      (a.section && !text(a.section, 100)) ||
      (a.labels &&
        (!array(a.labels, 100) ||
          a.labels.some((id) => !labels.has(id)) ||
          new Set(a.labels).size !== a.labels.length)) ||
      (a.time && (!task.plannedDay || !validTime(a.time))) ||
      (a.duration != null &&
        (!Number.isInteger(a.duration) ||
          a.duration < 1 ||
          a.duration > 1440)) ||
      (a.priority != null && ![1, 2, 3, 4].includes(a.priority)) ||
      (a.reminder &&
        !(
          typeof a.reminder === "string" &&
          validDay(a.reminder.slice(0, 10)) &&
          a.reminder[10] === "T" &&
          validTime(a.reminder.slice(11))
        )) ||
      (a.repeat &&
        (!task.plannedDay ||
          !["fixed", "after"].includes(a.repeat.mode) ||
          !Number.isInteger(a.repeat.days) ||
          a.repeat.days < 1 ||
          a.repeat.days > 3650))
    )
      reject("タスクの日付・分類・繰り返し設定を確認してください");
    const source = a.source;
    if (
      source &&
      (!["student", "lesson"].includes(source.kind) ||
        !text(source.name, 500) ||
        (source.kind === "lesson" &&
          (!validDay(source.day) ||
            !text(source.event, 1024) ||
            !text(source.calendar, 1024))))
    )
      reject("紐付け元を確認してください");
  }
}
export function preparePlanner(state, previous, now = Date.now()) {
  const day = dayAt(now);
  state.planner = { ...defaults(), ...(state.planner ?? previous.planner) };
  const oldTasks = new Map(previous.tasks.map((t) => [t.id, t]));
  const tasks = [...state.tasks];
  const taskIds = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    const old = oldTasks.get(t.id);
    if (old?.plan && t.plan === undefined) t.plan = { ...old.plan };
    if (!t.plan) continue;
    const plan = (t.plan = { ...t.plan });
    if (plan.parent && oldTasks.has(plan.parent) && !taskIds.has(plan.parent))
      plan.parent = null;
    // A legacy task editor can change the old numeric priority field on its own.
    if (
      old &&
      old.priority !== t.priority &&
      plan.priority === old.plan?.priority
    )
      plan.priority = t.priority ? 4 - t.priority : 4;
    if (old?.plan?.repeatIssued) plan.repeatIssued = true;
    else delete plan.repeatIssued;
    if (JSON.stringify(t) !== JSON.stringify(old)) plan.updatedDay = day;
    if (
      old &&
      statusOf(old) !== "done" &&
      statusOf(t) === "done" &&
      plan.repeat &&
      !plan.repeatIssued
    ) {
      validate({ ...state, tasks: [...tasks] });
      const scheduled = nextDay(plan.repeat, t.plannedDay, day);
      const nextPlan = { ...plan, updatedDay: day };
      const gap = (Date.parse(scheduled) - Date.parse(t.plannedDay)) / 86400000;
      if (plan.reminder)
        nextPlan.reminder =
          addDays(plan.reminder.slice(0, 10), gap) + plan.reminder.slice(10);
      plan.repeatIssued = true;
      state.tasks.push({
        id: crypto.randomUUID(),
        name: t.name,
        category: t.category,
        roleId: t.roleId,
        status: "pending",
        progress: 0,
        priority: t.priority,
        important: !!t.important,
        plannedDay: scheduled,
        deadline: t.deadline ? addDays(t.deadline, gap) : null,
        memo: "",
        reusableDescription: t.reusableDescription || "",
        checklist: (t.checklist || []).map((step) => ({
          ...step,
          checked: false,
        })),
        createdAt: day,
        plan: nextPlan,
      });
    }
  }
  validate(state);
}
