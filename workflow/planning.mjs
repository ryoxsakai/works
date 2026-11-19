export const dateJP = (x) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(x));
export const runTime = (r) => {
  const current = r.data.tasks?.[r.data.current];
  const terminal = ["completed", "cancelled"].includes(r.status);
  const latest = [
    ...(r.data.tasks || []).slice(
      0,
      Math.min((r.data.current ?? 0) + 1, r.data.tasks?.length || 0),
    ),
  ]
    .reverse()
    .find((t) => t.plan || Object.hasOwn(t, "planned_for"));
  // A terminal card stays on its last planned date. Next task uses its own reservation,
  // then the original run date; it never inherits a completed predecessor's plan.
  if (terminal && latest)
    return latest.planned_for || latest.plan?.planned_for || null;
  if (current && (current.plan || Object.hasOwn(current, "planned_for")))
    return current.planned_for || current.plan?.planned_for || null;
  if (r.data.plan) return r.data.plan.planned_for || null; // Initial PR compatibility.
  return (
    (r.scheduled_for.startsWith("manual:")
      ? r.data.created_at
      : r.scheduled_for) || null
  );
};
export const orderRuns = (a, b) =>
  (Date.parse(runTime(a)) || Infinity) - (Date.parse(runTime(b)) || Infinity) ||
  a.id.localeCompare(b.id);
export const roleOf = (r) =>
  r.data.tasks[Math.min(r.data.current, r.data.tasks.length - 1)]
    ?.role_snapshot;
