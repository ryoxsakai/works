// Planning has no execution side effects. All times are absolute UTC; the horizon is Tokyo dates.
export const tokyoDay = (x) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(x));
export function planningWindow(now = Date.now()) {
  const start = Date.parse(tokyoDay(now) + "T00:00:00+09:00");
  return { start, end: start + 4 * 86400000, now };
}
export const taskTime = (task) => task.planned_for || null;
// Stable priority/deadline ordering; each serial chain is released only after its predecessor.
// Roles are resource lanes. A fixed or running reservation is never moved by this function.
export function rollingPlans(runs, now = Date.now()) {
  const { end } = planningWindow(now),
    reservations = new Map(),
    results = [],
    blocked = [];
  const slot = 30 * 60000;
  const lane = (t) => t.role_id || "unassigned";
  const reserve = (key, start) => {
    if (!reservations.has(key)) reservations.set(key, []);
    reservations.get(key).push([start, start + slot]);
  };
  for (const r of runs)
    for (const t of r.data.tasks) {
      if (t.status === "running") reserve(lane(t), now);
      else if (
        (t.fixed || !r.data.definition.planning_policy?.enabled) &&
        t.status === "pending" &&
        t.planned_for
      )
        reserve(lane(t), Date.parse(t.planned_for));
    }
  const ordered = [...runs].sort(
    (a, b) =>
      a.data.definition.priority - b.data.definition.priority ||
      (Date.parse(a.data.definition.deadline) || Infinity) -
        (Date.parse(b.data.definition.deadline) || Infinity) ||
      a.id.localeCompare(b.id),
  );
  for (const r of ordered) {
    if (
      !r.data.definition.planning_policy?.enabled ||
      !["queued", "running", "review"].includes(r.status)
    )
      continue;
    let after = Math.max(now, Date.parse(r.not_before) || now);
    for (let i = r.data.current; i < r.data.tasks.length; i++) {
      const t = r.data.tasks[i];
      if (t.status !== "pending" || t.fixed) {
        after = Math.max(after, (Date.parse(t.planned_for) || now) + slot);
        continue;
      }
      const candidates = [
        ...new Set([
          t.role_id || null,
          ...r.data.definition.planning_policy.role_ids,
        ]),
      ];
      // Reassignment uses only owner-approved candidate roles; prefer current role on ties.
      let best;
      for (const role_id of candidates) {
        let at = Math.ceil(after / slot) * slot;
        for (const [start, finish] of [
          ...(reservations.get(role_id || "unassigned") || []),
        ].sort((a, b) => a[0] - b[0]))
          if (at < finish && at + slot > start)
            at = Math.ceil(finish / slot) * slot;
        if (!best || at < best.at) best = { role_id, at };
      }
      const deadline = Date.parse(r.data.definition.deadline) || Infinity;
      const nextFixed = r.data.tasks
        .slice(i + 1)
        .find((x) => x.fixed && x.planned_for);
      const upper = Math.min(
        end,
        deadline,
        nextFixed ? Date.parse(nextFixed.planned_for) : Infinity,
      );
      if (!best || best.at + slot > upper) {
        blocked.push({
          run_id: r.id,
          task_index: i,
          reason:
            "No slot within Tokyo 4-day horizon, deadline or fixed dependency",
        });
        break;
      }
      const plan = {
        task_index: i,
        role_id: best.role_id,
        planned_for: new Date(best.at).toISOString(),
        instruction: t.instruction || t.title,
        rationale: `優先度${r.data.definition.priority}・期限・直列依存・担当の空き枠を確認（30分枠）`,
      };
      results.push({ run_id: r.id, revision: r.revision, plan });
      reserve(best.role_id || "unassigned", best.at);
      after = best.at + slot;
    }
  }
  return {
    plans: results,
    blocked,
    horizon_end: new Date(end).toISOString(),
    slot_minutes: 30,
  };
}
