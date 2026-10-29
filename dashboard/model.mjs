export const MODULES = [
  ["/tutor/", "授業管理", "bx-book-reader"],
  ["/material/", "教材管理", "bx-library"],
  ["/admission/", "入試管理", "bx-calendar-event"],
  ["/todo/", "ToDo", "bx-list-check"],
  ["/memo/", "メモ", "bx-note"],
  ["/workflow/", "ワークフロー", "bx-git-branch"],
  ["/wiki/", "Wiki", "bx-library"],
  ["/kdp/", "KDP管理", "bx-book-open"],
  ["/ss/", "SS管理", "bx-briefcase-alt-2"],
];
export const WIDGETS = {
  todo: {
    title: "今日のToDo",
    icon: "bx-list-check",
    path: "/todo/",
    description: "今日までの予定と、7日以内・期限超過の締切",
  },
  lessons: {
    title: "今日の授業",
    icon: "bx-book-reader",
    path: "/tutor/",
    description: "選択済みカレンダーの予定（日本時間）",
  },
  shortcuts: {
    title: "よく使う機能",
    icon: "bx-grid-alt",
    description: "選んだ旧画面へのショートカット",
  },
  memo: {
    title: "最近のメモ",
    icon: "bx-note",
    path: "/memo/",
    description: "更新日時順のタイトルのみ。本文は表示しません",
  },
  materials: {
    title: "最近追加した教材",
    icon: "bx-library",
    path: "/material/",
    description: "追加日時順のファイル名。最近の使用順ではありません",
  },
  ss: {
    title: "SSの締切",
    icon: "bx-briefcase-alt-2",
    path: "/ss/",
    description: "未完了の案件を締切順に表示",
  },
};
export const defaults = () => ({
  version: 1,
  widgets: ["todo", "lessons", "shortcuts"],
  shortcuts: ["/tutor/", "/todo/", "/memo/", "/material/"],
});
export function validateLayout(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.widgets) ||
    !Array.isArray(value.shortcuts) ||
    value.widgets.length > 6 ||
    value.shortcuts.length > 9 ||
    value.widgets.some(
      (id) => typeof id !== "string" || !Object.hasOwn(WIDGETS, id),
    ) ||
    value.shortcuts.some((path) => !MODULES.some((m) => m[0] === path)) ||
    new Set(value.widgets).size !== value.widgets.length ||
    new Set(value.shortcuts).size !== value.shortcuts.length
  )
    throw new Error("表示設定の形式が正しくありません");
  return {
    version: 1,
    widgets: [...value.widgets],
    shortcuts: [...value.shortcuts],
  };
}
export function readLayout(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (raw !== null && raw.length > 8192) throw new Error();
    return {
      layout: raw === null ? defaults() : validateLayout(JSON.parse(raw)),
      error: "",
    };
  } catch {
    return {
      layout: defaults(),
      error:
        "表示設定を読み込めなかったため初期配置を表示しています。業務データには影響しません。",
    };
  }
}
export const dayJst = (now = Date.now()) =>
  new Date(now + 9 * 3600000).toISOString().slice(0, 10);
export const offsetDay = (day, n) =>
  new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10);
export const statusOf = (t) =>
  t.status ??
  (t.progress === 100 ? "done" : t.progress > 0 ? "doing" : "pending");
export function todoSummary(tasks, day) {
  const active = tasks.filter((t) => statusOf(t) !== "done");
  return {
    planned: active
      .filter((t) => t.plannedDay && t.plannedDay <= day)
      .sort(
        (a, b) =>
          Number(b.important || b.priority === 3) -
          Number(a.important || a.priority === 3),
      ),
    due: active
      .filter((t) => t.deadline && t.deadline <= offsetDay(day, 7))
      .sort((a, b) => a.deadline.localeCompare(b.deadline)),
  };
}
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
