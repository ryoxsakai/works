import { activeRole } from "./workflow-roles.js";
import { planningWindow } from "./workflow-planner.js";
const owner = (env) => env.ALLOWED_EMAIL.toLowerCase();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const decode = (r) => (r ? { ...r, data: JSON.parse(r.data) } : null);
export const stagedId = (definition_id, scheduled_for) =>
  definition_id + "@" + scheduled_for;
export async function stagedRead(env, offset = 0) {
  if (!Number.isSafeInteger(offset) || offset < 0)
    fail(400, "invalid stage offset");
  try {
    const rows = (
      await env.DB.prepare(
        `SELECT p.*,CASE WHEN d.enabled=1 AND d.archived=0 AND d.data=p.definition_data AND d.next_due<=p.scheduled_for AND NOT EXISTS(SELECT 1 FROM wf_runs r WHERE r.owner=p.owner AND r.definition_id=p.definition_id AND r.scheduled_for=p.scheduled_for) THEN 1 ELSE 0 END AS current FROM wf_staged_plans p LEFT JOIN wf_definitions d ON d.id=p.definition_id AND d.owner=p.owner WHERE p.owner=? AND (p.scheduled_for>=? OR EXISTS(SELECT 1 FROM json_each(p.data,'$.plans') t WHERE json_extract(t.value,'$.planned_for')>=?)) ORDER BY p.scheduled_for DESC,p.id LIMIT 201 OFFSET ?`,
      )
        .bind(
          owner(env),
          new Date(planningWindow().start).toISOString(),
          new Date(planningWindow().start).toISOString(),
          offset,
        )
        .all()
    ).results;
    return {
      plans: rows.slice(0, 200).map((row) => {
        const { definition_data, ...r } = decode(row);
        return r;
      }),
      truncated: rows.length > 200,
      next_offset: rows.length > 200 ? offset + 200 : null,
    };
  } catch (e) {
    if (/no such table/.test(e.message)) return null;
    throw e;
  }
}
export async function stagedSnapshot(env, d, scheduled) {
  try {
    const row = decode(
      await env.DB.prepare(
        "SELECT * FROM wf_staged_plans WHERE owner=? AND definition_id=? AND scheduled_for=?",
      )
        .bind(owner(env), d.id, scheduled)
        .first(),
    );
    return {
      revision: row?.revision || 0,
      plans:
        row?.definition_data === JSON.stringify(d.data)
          ? row.data.plans || {}
          : {},
    };
  } catch (e) {
    if (/no such table/.test(e.message)) return { revision: null, plans: {} };
    throw e;
  }
}
export function validateSlot(d, slot, period) {
  const at = Date.parse(slot),
    start = Date.parse(d.data.start),
    gap = at - start,
    { end } = planningWindow();
  if (
    !d.enabled ||
    d.archived ||
    !d.next_due ||
    at < Date.now() ||
    at >= end ||
    at < Date.parse(d.next_due) ||
    gap < 0 ||
    (period ? gap % period !== 0 : gap !== 0)
  )
    fail(
      409,
      "future slot must match an approved schedule within the Tokyo 4-day horizon",
    );
}
export async function stageWrite(env, a, browser, h) {
  const d = await h.definition(env, a.definition_id);
  if (d.revision !== a.definition_revision) fail(409, "definition changed");
  const scheduled = h.due(a.scheduled_for);
  validateSlot(d, scheduled, h.periodOf(d.data));
  const id = stagedId(d.id, scheduled);
  let old;
  try {
    old = decode(
      await env.DB.prepare(
        "SELECT * FROM wf_staged_plans WHERE id=? AND owner=?",
      )
        .bind(id, owner(env))
        .first(),
    );
  } catch (e) {
    if (/no such table/.test(e.message))
      fail(503, "Apply workflow migration 0003-staged-plans.sql");
    throw e;
  }
  const expected = a.stage_revision ?? 0;
  if (
    !Number.isSafeInteger(expected) ||
    expected < 0 ||
    (old?.revision || 0) !== expected
  )
    fail(409, "staged plan changed");
  const data =
    old?.definition_data === JSON.stringify(d.data)
      ? structuredClone(old.data)
      : { plans: {}, suggestions: {} };
  const fake = {
    current: 0,
    definition: d.data,
    tasks: d.data.tasks.map((t, i) => ({
      ...t,
      ...(data.plans[i]
        ? {
            role_id: data.plans[i].role_id,
            instruction: data.plans[i].instruction,
            planned_for: data.plans[i].planned_for,
          }
        : {}),
      status: "pending",
    })),
  };
  const proposals = Array.isArray(a.plans) ? a.plans : [a.plan];
  if (!proposals.length || proposals.length > 30)
    fail(400, "1–30 plans required");
  const applying = a.mode === "apply";
  if (!applying && a.mode !== "suggest") fail(400, "invalid stage mode");
  const manual = applying && browser && a.authorized === true;
  for (const proposal of proposals) {
    const plan = h.validatePlan(proposal, fake);
    if (applying && !manual) h.validateBounds(plan, fake);
    if (
      plan.planned_for &&
      Date.parse(plan.planned_for) < Date.parse(scheduled)
    )
      fail(400, "future task cannot be planned before its scheduled Run");
    const role = await activeRole(env, plan.role_id);
    if (applying) {
      data.plans[plan.task_index] = { ...plan, role_snapshot: role };
      data.suggestions[plan.task_index] = null;
    } else data.suggestions[plan.task_index] = plan;
  }
  let previous = -Infinity;
  for (let i = 0; i < d.data.tasks.length; i++) {
    const at = Date.parse(data.plans[i]?.planned_for);
    if (Number.isFinite(at)) {
      if (at < previous)
        fail(409, "planning dates must respect serial dependencies");
      previous = at;
    }
  }
  const stored = await env.DB.prepare(
    `INSERT INTO wf_staged_plans(id,owner,definition_id,definition_revision,scheduled_for,definition_data,data) SELECT ?,?,?,?,?,?,? WHERE ?=0 AND EXISTS(SELECT 1 FROM wf_definitions WHERE id=? AND owner=? AND revision=? AND enabled=1 AND archived=0) AND NOT EXISTS(SELECT 1 FROM wf_runs WHERE owner=? AND definition_id=? AND scheduled_for=?) AND NOT EXISTS(SELECT 1 FROM wf_settings WHERE owner=? AND stopped=1) ON CONFLICT(id) DO UPDATE SET definition_revision=excluded.definition_revision,definition_data=excluded.definition_data,data=excluded.data,revision=wf_staged_plans.revision+1 WHERE wf_staged_plans.owner=excluded.owner AND wf_staged_plans.revision=? RETURNING *`,
  )
    .bind(
      id,
      owner(env),
      d.id,
      d.revision,
      scheduled,
      JSON.stringify(d.data),
      JSON.stringify(data),
      old ? 0 : expected,
      d.id,
      owner(env),
      d.revision,
      owner(env),
      d.id,
      scheduled,
      owner(env),
      expected,
    )
    .first();
  // On update, the SELECT guard must still run; old rows use zero to enter ON CONFLICT.
  if (!stored) fail(409, "staged plan, definition, global stop or Run changed");
  const { definition_data, ...result } = decode(stored);
  return result;
}
