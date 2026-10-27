// Role labels describe responsibility; they never grant execution permissions.
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const owner = (env) => env.ALLOWED_EMAIL.toLowerCase();
const text = (v, max = 2000) => {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    fail(400, "invalid role text");
  return v.trim();
};
export const roleColors = ["rose", "sky", "mint", "amber", "violet"];
export const roleIcons = ["●", "◆", "★", "☑", "◎"];
export async function rolesRead(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM wf_roles WHERE owner=? ORDER BY archived,id",
    )
      .bind(owner(env))
      .all();
    return results.map((r) => ({ ...r, data: JSON.parse(r.data) }));
  } catch (e) {
    if (/no such table/.test(e.message)) return null; // Legacy installation stays readable.
    throw e;
  }
}
export async function activeRole(env, id) {
  if (!id) return null;
  let role;
  try {
    role = await env.DB.prepare(
      "SELECT * FROM wf_roles WHERE id=? AND owner=? AND archived=0",
    )
      .bind(text(id, 100), owner(env))
      .first();
  } catch (e) {
    if (/no such table/.test(e.message))
      fail(503, "Apply workflow migration 0002-roles.sql");
    throw e;
  }
  if (!role) fail(409, "担当がありません、またはアーカイブ済みです");
  return { id: role.id, revision: role.revision, ...JSON.parse(role.data) };
}
export async function rolesWrite(env, a, browser) {
  if (!browser) fail(403, "role changes require browser owner");
  if ((await rolesRead(env)) === null)
    fail(503, "Apply workflow migration 0002-roles.sql");
  if (a.action === "role_create") {
    const d = validateRole(a.content),
      id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO wf_roles(id,owner,data) VALUES(?,?,?)")
      .bind(id, owner(env), JSON.stringify(d))
      .run();
    return { id };
  }
  const r = await env.DB.prepare(
    "SELECT * FROM wf_roles WHERE id=? AND owner=?",
  )
    .bind(text(a.role_id, 100), owner(env))
    .first();
  if (!r) fail(404, "role not found");
  if (r.revision !== a.revision || r.archived)
    fail(409, "role changed or archived");
  if (a.action === "role_edit") {
    const saved = await env.DB.prepare(
      "UPDATE wf_roles SET data=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND archived=0 RETURNING id",
    )
      .bind(
        JSON.stringify(validateRole(a.content)),
        r.id,
        owner(env),
        r.revision,
      )
      .first();
    if (!saved) fail(409, "role changed");
    return saved;
  }
  // Used roles are archived, never deleted. Existing immutable history keeps their label.
  // Unfinished references must first be explicitly reassigned, including draft definitions.
  const unfinished = await env.DB.prepare(
    `SELECT id FROM wf_runs WHERE owner=? AND status NOT IN ('completed','cancelled') AND EXISTS(SELECT 1 FROM json_each(data,'$.tasks') t WHERE json_extract(t.value,'$.role_id')=? AND json_extract(t.value,'$.status')!='completed') UNION ALL SELECT id FROM wf_definitions WHERE owner=? AND archived=0 AND (EXISTS(SELECT 1 FROM json_each(data,'$.tasks') t WHERE json_extract(t.value,'$.role_id')=?) OR EXISTS(SELECT 1 FROM json_each(data,'$.planning_policy.role_ids') p WHERE p.value=?)) LIMIT 1`,
  )
    .bind(owner(env), r.id, owner(env), r.id, r.id)
    .first();
  if (unfinished)
    fail(
      409,
      "未完了の工程・定義を別の担当へ変更してからアーカイブしてください。実行中は停止・結果確認が必要です",
    );
  // Atomic predicate also protects against concurrent definition/run assignment.
  let saved;
  try {
    saved = await env.DB.prepare(
      `UPDATE wf_roles SET archived=1,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND NOT EXISTS(SELECT 1 FROM wf_runs r,json_each(r.data,'$.tasks') t WHERE r.owner=? AND r.status NOT IN ('completed','cancelled') AND json_extract(t.value,'$.role_id')=wf_roles.id AND json_extract(t.value,'$.status')!='completed') AND NOT EXISTS(SELECT 1 FROM wf_definitions d WHERE d.owner=? AND d.archived=0 AND (EXISTS(SELECT 1 FROM json_each(d.data,'$.tasks') t WHERE json_extract(t.value,'$.role_id')=wf_roles.id) OR EXISTS(SELECT 1 FROM json_each(d.data,'$.planning_policy.role_ids') p WHERE p.value=wf_roles.id))) RETURNING id`,
    )
      .bind(r.id, owner(env), r.revision, owner(env), owner(env))
      .first();
  } catch (e) {
    if (/staged plans reference role/.test(e.message))
      fail(409, "将来予定の担当を変更してからアーカイブしてください");
    throw e;
  }
  if (!saved) fail(409, "role references changed");
  return saved;
}
function validateRole(d) {
  if (!d || !roleColors.includes(d.color) || !roleIcons.includes(d.icon))
    fail(400, "invalid role color/icon");
  return {
    name: text(d.name, 100),
    responsibilities: text(d.responsibilities),
    operations: text(d.operations),
    completion: text(d.completion),
    color: d.color,
    icon: d.icon,
  };
}
