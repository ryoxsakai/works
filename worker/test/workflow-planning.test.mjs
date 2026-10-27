import test from "node:test";
import assert from "node:assert/strict";
import { dateJP, orderRuns, runTime } from "../../workflow/planning.mjs";
test("Tokyo midnight, date ordering, manual timestamps and undated entries", () => {
  assert.equal(dateJP("2026-10-26T15:00:00Z"), "2026-10-27");
  assert.equal(dateJP("2026-10-26T14:59:59Z"), "2026-10-26");
  const runs = [
    { id: "none", scheduled_for: "manual:1", data: {} },
    { id: "late", scheduled_for: "2026-10-27T01:00:00Z", data: {} },
    {
      id: "early",
      scheduled_for: "manual:2",
      data: { created_at: "2026-10-26T22:00:00Z" },
    },
    {
      id: "plan",
      scheduled_for: "2026-10-30T01:00:00Z",
      data: { plan: { planned_for: "2026-10-26T20:00:00Z" } },
    },
  ];
  assert.deepEqual(
    runs.sort(orderRuns).map((r) => r.id),
    ["plan", "early", "late", "none"],
  );
  assert.equal(runTime(runs.at(-1)), null);
  assert.equal(
    runTime({
      scheduled_for: "2026-10-27T00:00:00Z",
      data: { plan: { planned_for: null } },
    }),
    null,
  );
});

test("terminal cards retain replanned date; next task falls back independently", () => {
  const run = {
    id: "run",
    status: "completed",
    scheduled_for: "2026-10-26T00:00:00Z",
    data: {
      current: 1,
      plan: null,
      tasks: [
        {
          planned_for: "2026-10-29T00:00:00Z",
          plan: { planned_for: "2026-10-29T00:00:00Z" },
        },
      ],
    },
  };
  assert.equal(runTime(run), "2026-10-29T00:00:00Z");
  run.status = "queued";
  run.data.tasks.push({ status: "pending" });
  assert.equal(runTime(run), "2026-10-26T00:00:00Z");
  run.data.tasks[1].planned_for = null;
  assert.equal(runTime(run), null);
});
