export const palette = {
  slate: ["スレート", "#64748b"],
  blue: ["青", "#377ad2"],
  teal: ["青緑", "#008c88"],
  green: ["緑", "#469444"],
  yellow: ["黄", "#bd9110"],
  orange: ["オレンジ", "#cf7227"],
  red: ["赤", "#ca5353"],
  pink: ["ピンク", "#c4558b"],
  purple: ["紫", "#9164be"],
};
export const defaults = () => ({
  projects: [],
  labels: [],
  filters: [],
  review: null,
  calendar: false,
});
export const statusOf = (t) =>
  t.status ??
  (t.progress === 100 ? "done" : t.progress > 0 ? "doing" : "pending");
export const dayAt = (ms) =>
  new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
export const addDays = (day, n) =>
  new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
export const validDay = (day) =>
  typeof day === "string" &&
  /^\d{4}-\d\d-\d\d$/.test(day) &&
  Number.isFinite(Date.parse(day)) &&
  addDays(day, 0) === day;
export const validTime = (time) =>
  typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
export const priorityOf = (t) =>
  t.plan?.priority ?? (t.priority ? 4 - t.priority : 4);
export function ancestry(items, id, parent = (x) => x.parent) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result = [],
    seen = new Set();
  while (id && byId.has(id) && !seen.has(id)) {
    const item = byId.get(id);
    seen.add(id);
    result.unshift(item);
    id = parent(item);
  }
  return result;
}
export function projectPath(items, id) {
  return ancestry(items, id)
    .map((item) => item.name)
    .join(" / ");
}
export const sortNames = {
  manual: "手動",
  plannedDay: "予定日",
  deadline: "締切",
  priority: "優先度",
  name: "名前",
};
const collator = new Intl.Collator("ja", { numeric: true });
export function sortTasks(tasks, sort) {
  const key = (t) => {
    if (sort === "priority") return priorityOf(t);
    if (sort === "plannedDay")
      return (t.plannedDay || "9999") + (t.plan?.time || "24:00");
    if (sort === "deadline") return t.deadline || "9999";
    return t.name;
  };
  return sort === "manual"
    ? [...tasks]
    : [...tasks].sort((a, b) => collator.compare(key(a), key(b)));
}
export const isInbox = (t) =>
  statusOf(t) !== "done" &&
  !t.plannedDay &&
  !t.plan?.project &&
  !t.plan?.parent;
export function reviewItems(tasks, projects, stage, day) {
  const active = tasks.filter((t) => statusOf(t) !== "done");
  if (stage === 0) return active.filter(isInbox);
  if (stage === 1) return active.filter((t) => statusOf(t) === "waiting");
  const cutoff = addDays(day, -7);
  return projects.filter((project) => {
    if (projects.some((p) => p.parent === project.id)) return false;
    const items = tasks.filter((t) => t.plan?.project === project.id);
    if (items.length && items.every((t) => statusOf(t) === "done"))
      return false;
    return ![
      project.createdDay,
      ...items.map(
        (t) =>
          t.plan?.updatedDay ||
          t.completedAt?.slice(0, 10) ||
          t.createdAt?.slice(0, 10),
      ),
    ].some((d) => d && d > cutoff);
  });
}
export function nextDay(rule, scheduled, completion) {
  const base = scheduled || completion;
  if (rule.mode === "after") return addDays(completion, rule.days);
  const periods = Math.max(
    1,
    Math.floor(
      (Date.parse(completion) - Date.parse(base)) / 86400000 / rule.days,
    ) + 1,
  );
  return addDays(base, periods * rule.days);
}
export function parseQuick(input, day, scheduledDay = day) {
  const result = {
    name: "",
    labels: [],
    project: "",
    priority: null,
    day: null,
    time: null,
    repeat: null,
  };
  const names = [];
  for (const token of input.trim().split(/\s+/u)) {
    const value = token.normalize("NFKC");
    const weekly = /^毎週([日月火水木金土])(?:曜(?:日)?)?$/.exec(value);
    const after = /^完了(?:から|後)([1-9]\d{0,2})日(?:後)?$/.exec(value);
    if (weekly) {
      const delta =
        ("日月火水木金土".indexOf(weekly[1]) - new Date(day).getUTCDay() + 7) %
        7;
      result.day = addDays(day, delta);
      result.repeat = { mode: "fixed", days: 7 };
    } else if (after) result.repeat = { mode: "after", days: Number(after[1]) };
    else if (value === "毎日") {
      result.repeat = { mode: "fixed", days: 1 };
      result.day ||= scheduledDay;
    } else if (["今日", "明日", "明後日"].includes(value))
      result.day = addDays(day, ["今日", "明日", "明後日"].indexOf(value));
    else if (validDay(value)) result.day = value;
    else if (/^([01]?\d|2[0-3]):[0-5]\d$/.test(value))
      result.time = value.padStart(5, "0");
    else if (/^p[1-4]$/i.test(value)) result.priority = Number(value[1]);
    else if (/^#.{1,100}$/u.test(value)) result.project = value.slice(1);
    else if (/^@.{1,100}$/u.test(value)) result.labels.push(value.slice(1));
    else names.push(token);
  }
  if (result.time || result.repeat) result.day ||= scheduledDay;
  result.name = names.join(" ");
  return result;
}
