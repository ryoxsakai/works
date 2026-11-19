export const STATUS_CLASSES = {
  "原稿待ち": "waiting",
  "素材案作成中": "drafting",
  "素材案確認待ち": "review",
  "問題作成中": "writing",
  "完了": "completed",
};

export const STATUS_ORDER = {
  "原稿待ち": 0,
  "素材案作成中": 1,
  "素材案確認待ち": 2,
  "問題作成中": 3,
  "完了": 4,
};

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

export function todayInJapan() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function dateNumber(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

export function remainingDays(deadline) {
  return Math.round((dateNumber(deadline) - dateNumber(todayInJapan())) / 86_400_000);
}

export function remaining(project) {
  if (project.status === "完了") return { text: "完了", className: "completed" };
  const days = remainingDays(project.deadline);
  if (!Number.isFinite(days)) return { text: "—", className: "" };
  if (days < 0) return { text: `${Math.abs(days)}日超過`, className: "overdue" };
  if (days === 0) return { text: "本日", className: "due-week-1" };
  if (days <= 7) return { text: `あと${days}日`, className: "due-week-1" };
  if (days <= 14) return { text: `あと${days}日`, className: "due-week-2" };
  if (days <= 21) return { text: `あと${days}日`, className: "due-week-3" };
  if (days <= 28) return { text: `あと${days}日`, className: "due-week-4" };
  return { text: `あと${days}日`, className: "due-beyond" };
}

export function formatDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function sortValue(project, key) {
  if (key === "name") return String(project.name || "");
  if (key === "status") return STATUS_ORDER[project.status] ?? Number.MAX_SAFE_INTEGER;
  if (key === "deadline") return dateNumber(project.deadline);
  if (key === "remaining") return remainingDays(project.deadline);
  return "";
}

export function sortedOriginal(projects,sortState) {
  const multiplier = sortState.direction === "desc" ? -1 : 1;
  return [...projects].sort((a, b) => {
    const left = sortValue(a, sortState.key);
    const right = sortValue(b, sortState.key);
    let result;
    if (typeof left === "string" || typeof right === "string") {
      result = String(left).localeCompare(String(right), "ja", { numeric: true, sensitivity: "base" });
    } else {
      result = Number(left) - Number(right);
    }
    return result === 0
      ? String(a.name || "").localeCompare(String(b.name || ""), "ja", { numeric: true })
      : result * multiplier;
  });
}

