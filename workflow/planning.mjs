export const dateJP = (x) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(x));
export const runTime = (r) =>
  r.data.plan
    ? r.data.plan.planned_for || null
    : (r.scheduled_for.startsWith("manual:")
        ? r.data.created_at
        : r.scheduled_for) || null;
export const orderRuns = (a, b) =>
  (Date.parse(runTime(a)) || Infinity) - (Date.parse(runTime(b)) || Infinity) ||
  a.id.localeCompare(b.id);
export const roleOf = (r) =>
  r.data.tasks[Math.min(r.data.current, r.data.tasks.length - 1)]
    ?.role_snapshot;
