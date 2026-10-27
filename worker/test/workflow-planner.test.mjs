import test from "node:test";
import assert from "node:assert/strict";
import { rollingPlans, planningWindow } from "../src/workflow-planner.js";
const now = Date.parse("2026-10-26T15:10:00Z");
const run = (id, priority, tasks, other = {}) => ({
  id,
  revision: 1,
  status: "queued",
  data: {
    current: 0,
    definition: {
      priority,
      deadline: null,
      planning_policy: { enabled: true, role_ids: ["a", "b"] },
      ...other,
    },
    tasks: tasks.map((t) => ({
      title: "確認",
      status: "pending",
      role_id: "a",
      ...t,
    })),
  },
});
test("rolling planning uses Tokyo 4-day horizon, priority, deadline, serial dependencies and free role lanes", () => {
  assert.equal(
    new Date(planningWindow(now).end).toISOString(),
    "2026-10-30T15:00:00.000Z",
  );
  const low = run("low", 3, [{}, {}]);
  const urgent = run("urgent", 1, [{}, {}]);
  const out = rollingPlans([low, urgent], now);
  assert.equal(out.plans[0].run_id, "urgent");
  assert.equal(out.plans[1].plan.planned_for, "2026-10-26T16:00:00.000Z");
  assert.equal(out.plans.find((p) => p.run_id === "low").plan.role_id, "b");
  const slots = out.plans.map((p) => p.plan.role_id + "@" + p.plan.planned_for);
  assert.equal(new Set(slots).size, slots.length);
  assert(
    out.plans.every(
      (p) => Date.parse(p.plan.planned_for) < planningWindow(now).end,
    ),
  );
  assert.equal(low.data.tasks[0].planned_for, undefined); // Preview is pure.
});
test("fixed and running reservations stay fixed; deadlines and fixed successors produce explicit blockers", () => {
  const fixed = run("fixed", 1, [
    { fixed: true, planned_for: "2026-10-26T15:30:00Z" },
  ]);
  const working = run("working", 1, [{ status: "running" }, {}]);
  working.status = "running";
  const noTime = run("late", 1, [{}], { deadline: "2026-10-26T15:20:00Z" });
  const out = rollingPlans([fixed, working, noTime], now);
  assert(!out.plans.some((p) => p.run_id === "fixed"));
  assert(
    !out.plans.some((p) => p.run_id === "working" && p.plan.task_index === 0),
  );
  assert(out.blocked.some((p) => p.run_id === "late"));
});
