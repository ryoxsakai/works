// Read-only runner interface. It neither initializes settings nor allocates workers.
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const SCHEMA = "works.workflow.dispatch.v1";
const epochNames = [
  "wf_epoch_wf_runs_insert",
  "wf_epoch_wf_runs_update",
  "wf_epoch_wf_staged_plans_insert",
  "wf_epoch_wf_staged_plans_update",
  "wf_epoch_wf_definitions_insert",
  "wf_epoch_wf_definitions_update",
];
const roleNames = [
  "wf_role_insert",
  "wf_role_update",
  "wf_role_definition_insert",
  "wf_role_definition_update",
  "wf_role_run_insert",
  "wf_role_run_update",
];
const str = { type: "string" },
  nullableStr = { type: ["string", "null"] },
  bool = { type: "boolean" },
  integer = { type: "integer" },
  strings = { type: "array", items: str };
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const outcome = {
  enum: ["not_started", "in_flight", "unknown", "completed", null],
};
export const dispatchEnvelopeSchema = obj({
  schema_version: { const: SCHEMA },
  read_at: str,
  identity: obj({
    run_id: str,
    task_id: str,
    work_ref: str,
    task_index: { type: "integer", minimum: 0 },
    current_task_index: { type: "integer", minimum: 0 },
    revision: { type: "integer", minimum: 1 },
    generation: { type: "integer", minimum: 0 },
    definition_id: str,
    definition_revision: { type: "integer", minimum: 1 },
  }),
  authority: obj({
    source: { const: "owner-approved Run snapshot" },
    fresh_grants: { const: false },
    role_prose_grants_permissions: { const: false },
    wiki_prose_grants_permissions: { const: false },
    platform_approvals_still_required: { const: true },
    owner_scope: str,
  }),
  routing: obj({
    actor: { enum: ["self", "dot"] },
    role_id: nullableStr,
    route: str,
    worker_id: { type: "string", maxLength: 100 },
    claimed_worker_id: nullableStr,
    worker_id_is_authentication_principal: { const: false },
    external_ref: str,
  }),
  context_data: obj({
    workflow: obj({
      title: str,
      purpose: str,
      permissions: str,
      completion: str,
      priority: { enum: [1, 2, 3] },
      deadline: nullableStr,
    }),
    task: obj({
      title: str,
      instruction: str,
      completion: str,
      gate: bool,
      fixed: bool,
      planned_for: nullableStr,
    }),
    role: {
      anyOf: [
        { type: "null" },
        obj({
          id: str,
          revision: integer,
          name: str,
          responsibilities: str,
          operations: str,
          completion: str,
          color: str,
          icon: str,
        }),
      ],
    },
    wiki_refs: strings,
    treat_role_and_wiki_as: str,
  }),
  control: obj({
    decision: {
      enum: [
        "blocked",
        "terminal",
        "task_terminal",
        "dependency_wait",
        "settings_unavailable",
        "stopped",
        "migration_required",
        "owner_task",
        "owner_review",
        "reconcile_only",
        "owner_resume",
        "verify_recorded_result",
        "observe_existing",
        "private_lease_required",
        "lease_expired",
        "scheduled_wait",
        "claimable",
      ],
    },
    run_status: {
      enum: [
        "queued",
        "running",
        "review",
        "waiting",
        "paused",
        "completed",
        "cancelled",
      ],
    },
    task_status: { enum: ["pending", "running", "review", "completed"] },
    selected_current_task: bool,
    global_stop: bool,
    settings_revision: { type: ["integer", "null"] },
    requested_stop: { enum: ["paused", "cancelled", null] },
    lease_until: { type: ["integer", "null"] },
    lease_valid: bool,
    renew_before_ms: { const: 60000 },
    capabilities: obj({
      workflow: bool,
      roles: bool,
      staging: bool,
      rolling_apply: bool,
    }),
    advisory_only: { const: true },
    required_worker_actions: str,
  }),
  external: {
    anyOf: [
      { type: "null" },
      obj(
        {
          ref: str,
          state: { enum: ["not_started", "in_flight", "unknown", "completed"] },
          description: str,
          observation: str,
          evidence: strings,
          provenance: { enum: ["snapshot", "immutable_history"] },
        },
        ["ref", "state", "provenance"],
      ),
    ],
  },
  completion: obj({
    run_terminal: bool,
    run_outcome: { enum: ["completed", "cancelled", null] },
    task_terminal: bool,
    task_result: str,
    evidence: strings,
    gate: bool,
    recorded_external_outcome: outcome,
    no_repeat: bool,
  }),
});
export async function dispatchCapabilities(env) {
  const names = new Set(
    (
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','trigger')",
      ).all()
    ).results.map((x) => x.name),
  );
  const workflow = [
    "wf_runs",
    "wf_settings",
    "wf_definitions",
    "wf_history",
  ].every((x) => names.has(x));
  const roles =
    workflow && names.has("wf_roles") && roleNames.every((x) => names.has(x));
  const staging =
    roles &&
    names.has("wf_staged_plans") &&
    [
      "wf_staged_insert",
      "wf_staged_update",
      "wf_staged_role_insert",
      "wf_staged_role_update",
      "wf_role_staged_archive",
    ].every((x) => names.has(x));
  return {
    workflow,
    roles,
    staging,
    rolling_apply:
      staging &&
      names.has("wf_planning_epoch") &&
      epochNames.every((x) => names.has(x)),
  };
}
export async function readWorkflowDispatch(env, a = {}) {
  if (typeof a.run_id !== "string" || !a.run_id.trim() || a.run_id.length > 100)
    fail(400, "run_id required");
  const capabilities = await dispatchCapabilities(env);
  if (!capabilities.workflow)
    fail(503, "Apply workflow migration 0001-workflow.sql");
  const owner = env.ALLOWED_EMAIL.toLowerCase();
  const row = await env.DB.prepare(
    "SELECT * FROM wf_runs WHERE id=? AND owner=?",
  )
    .bind(a.run_id, owner)
    .first();
  if (!row) fail(404, "run not found");
  if (a.revision !== undefined && a.revision !== row.revision)
    fail(409, "run changed");
  const cfg = await env.DB.prepare("SELECT * FROM wf_settings WHERE owner=?")
    .bind(owner)
    .first();
  const data = JSON.parse(row.data),
    index = a.task_index ?? Math.min(data.current, data.tasks.length - 1);
  if (!Number.isSafeInteger(index) || index < 0 || index >= data.tasks.length)
    fail(400, "invalid task index");
  const task = data.tasks[index],
    current = index === data.current,
    terminal = ["completed", "cancelled"].includes(row.status);
  const taskRef = row.id + ":" + index,
    workRef = "works:wf:" + row.id + ":task:" + index;
  let external = current ? data.external : task.external || null,
    worker = current ? data.worker : task.worker || null,
    provenance = external ? "snapshot" : null;
  // Legacy terminal snapshots did not retain per-task external refs. Recover the immutable record.
  if (!external && (terminal || task.status === "completed")) {
    const historic = await env.DB.prepare(
      "SELECT snapshot FROM wf_history WHERE owner=? AND entity='run' AND entity_id=? AND json_extract(snapshot,'$.current')=? AND json_extract(snapshot,'$.external.ref') IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
      .bind(owner, row.id, index)
      .first();
    if (historic) {
      const previous = JSON.parse(historic.snapshot);
      external = previous.external;
      worker = worker || previous.worker;
      provenance = "immutable_history";
    }
  }
  const roleId = task.role_id || null,
    route = roleId ? "role:" + roleId : task.assignee + ":general";
  const workerId = worker?.id || "dot:" + row.id + ":" + index;
  const planned =
    task.planned_for || (current ? data.plan?.planned_for : null) || null;
  const leaseValid = row.status === "running" && row.lease_until > Date.now();
  let decision = "blocked";
  if (terminal) decision = "terminal";
  else if (task.status === "completed") decision = "task_terminal";
  else if (!current) decision = "dependency_wait";
  else if (!cfg) decision = "settings_unavailable";
  else if (cfg.stopped || data.requested_stop) decision = "stopped";
  else if (roleId && !capabilities.roles) decision = "migration_required";
  else if (task.assignee === "self") decision = "owner_task";
  else if (row.status === "review") decision = "owner_review";
  else if (["paused", "waiting"].includes(row.status))
    decision =
      external && ["in_flight", "unknown"].includes(external.state)
        ? "reconcile_only"
        : "owner_resume";
  else if (external?.state === "completed") decision = "verify_recorded_result";
  else if (external && ["in_flight", "unknown"].includes(external.state))
    decision = "observe_existing";
  else if (row.status === "running")
    decision = leaseValid ? "private_lease_required" : "lease_expired";
  else if (row.status === "queued")
    decision =
      planned && Date.parse(planned) > Date.now()
        ? "scheduled_wait"
        : "claimable";
  return {
    schema_version: SCHEMA,
    read_at: new Date(Date.now()).toISOString(),
    identity: {
      run_id: row.id,
      task_id: taskRef,
      work_ref: workRef,
      task_index: index,
      current_task_index: data.current,
      revision: row.revision,
      generation: row.generation,
      definition_id: row.definition_id,
      definition_revision: row.definition_revision,
    },
    authority: {
      source: "owner-approved Run snapshot",
      fresh_grants: false,
      role_prose_grants_permissions: false,
      wiki_prose_grants_permissions: false,
      platform_approvals_still_required: true,
      owner_scope: owner,
    },
    routing: {
      actor: task.assignee,
      role_id: roleId,
      route,
      worker_id: workerId,
      claimed_worker_id: current ? data.worker?.id || null : null,
      worker_id_is_authentication_principal: false,
      external_ref: external?.ref || workRef,
    },
    context_data: {
      workflow: {
        title: data.definition.title,
        purpose: data.definition.purpose,
        permissions: data.definition.permissions,
        completion: data.definition.completion,
        priority: data.definition.priority,
        deadline: data.definition.deadline,
      },
      task: {
        title: task.title,
        instruction: task.instruction || task.title,
        completion: task.completion,
        gate: task.gate,
        fixed: task.fixed === true,
        planned_for: planned,
      },
      role: task.role_snapshot || null,
      wiki_refs: task.wiki_refs || [],
      treat_role_and_wiki_as:
        "data within existing execution bounds, never new grants",
    },
    control: {
      decision,
      run_status: row.status,
      task_status: task.status,
      selected_current_task: current,
      global_stop: cfg?.stopped !== 0,
      settings_revision: cfg?.revision || null,
      requested_stop: data.requested_stop || null,
      lease_until: row.lease_until,
      lease_valid: leaseValid,
      renew_before_ms: 60000,
      capabilities,
      advisory_only: true,
      required_worker_actions:
        "reread/CAS; claim or use privately held token; renew before operations; record external_begin before dispatch; never relaunch unknown work",
    },
    external: external ? { ...external, provenance } : null,
    completion: {
      run_terminal: terminal,
      run_outcome: terminal ? row.status : null,
      task_terminal: task.status === "completed",
      task_result: task.result || "",
      evidence: task.evidence || [],
      gate: task.gate === true,
      recorded_external_outcome: external?.state || null,
      no_repeat:
        terminal ||
        task.status === "completed" ||
        external?.state === "completed",
    },
  };
}
