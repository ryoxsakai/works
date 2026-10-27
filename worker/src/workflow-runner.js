// Testable parent-dot decision adapter. It does not contact an allocator, execute tools or store tokens.
// The runtime supplies durable owner-scoped lookup/idempotency; unsupported runtimes must wait.
export function roleWorkerInput(envelope) {
  if (envelope.schema_version !== "works.workflow.dispatch.v1")
    throw Error("unsupported dispatch schema");
  return {
    schema_version: "works.role-worker.input.v1",
    identity: { ...envelope.identity },
    routing: { ...envelope.routing },
    authority: { ...envelope.authority },
    context_data: structuredClone(envelope.context_data),
    contract: {
      fresh_grants: false,
      only_current_task: true,
      respect_platform_approvals: true,
      operation_model: "one_aggregate_job_per_task",
      external_begin_owner: "parent_dot_before_dispatch",
      worker_records_external_begin: false,
      job_ref_covers_all_task_effects: true,
      independent_effects_require_separate_tasks: true,
      same_reference_only: true,
      verified_completion_required: true,
      lease_secrets_via_private_runtime_only: true,
    },
  };
}
export function decideRunnerStep(
  envelope,
  { allocator = null, lookup = null, lease = null } = {},
) {
  const input = roleWorkerInput(envelope),
    c = envelope.control,
    id = envelope.identity,
    r = envelope.routing;
  const result = (action, extra = {}) => ({
    action,
    work_ref: id.work_ref,
    external_ref: r.external_ref,
    worker_id: r.worker_id,
    ...extra,
  });
  if (envelope.completion.run_terminal || envelope.completion.task_terminal)
    return result("terminal", {
      outcome: envelope.completion,
      allocate: false,
    });
  if (!c.selected_current_task)
    return result("dependency_wait", { allocate: false });
  if (c.global_stop || c.requested_stop)
    return result("stopped", {
      allocate: false,
      may_observe: !!envelope.external,
    });
  if (r.actor !== "dot") return result("owner_task", { allocate: false });
  if (
    [
      "migration_required",
      "settings_unavailable",
      "scheduled_wait",
      "owner_review",
      "owner_resume",
      "lease_expired",
    ].includes(c.decision)
  )
    return result(c.decision, { allocate: false });
  // This branch ALWAYS wins over allocator capabilities or a held lease on recovery.
  if (envelope.external && envelope.external.state !== "not_started") {
    if (!lookup) return result("lookup_existing", { allocate: false });
    if (lookup.work_ref !== r.external_ref)
      return result("unknown_reference", { allocate: false });
    return result(
      lookup.state === "completed"
        ? "verify_existing_completion"
        : lookup.state === "absent_verified"
          ? "verify_non_dispatch_then_owner_resume"
          : "observe_existing",
      {
        allocate: false,
        observation: lookup,
        requires_independent_verification: true,
      },
    );
  }
  if (!["claimable", "private_lease_required"].includes(c.decision))
    return result("control_blocked", {
      allocate: false,
      reason: "unsupported or blocked control decision",
    });
  const capable =
    allocator?.durable_lookup === true &&
    allocator?.idempotent_create === true &&
    allocator?.owner_scoped === true &&
    allocator?.accepts_work_ref === true &&
    allocator?.accepts_worker_id === true &&
    allocator?.aggregate_job_ref_covers_effects === true &&
    allocator?.lease_supervision === true;
  if (!capable)
    return result("allocator_unavailable", {
      allocate: false,
      reason:
        "No supported aggregate-job role-worker allocator with durable lookup/idempotency and lease supervision; do not invent a new worker or launch flag",
    });
  if (!lookup) return result("lookup_before_claim", { allocate: false });
  if (lookup.work_ref !== r.external_ref || lookup.state !== "absent_verified")
    return result(
      lookup.work_ref === r.external_ref && lookup.state === "completed"
        ? "verify_existing_completion"
        : "observe_existing",
      { allocate: false, observation: lookup },
    );
  if (c.decision === "claimable")
    return result("claim", {
      allocate: false,
      arguments: {
        action: "claim",
        run_id: id.run_id,
        revision: id.revision,
        worker_id: r.worker_id,
        ...(r.role_id ? { role_id: r.role_id } : {}),
      },
    });
  const owns =
    lease &&
    typeof lease.token === "string" &&
    lease.token.length > 0 &&
    lease.worker_id === r.claimed_worker_id &&
    lease.worker_id === r.worker_id &&
    lease.generation === id.generation &&
    c.lease_valid;
  if (!owns) return result("private_lease_required", { allocate: false });
  return result("renew_then_record_then_allocate_once", {
    allocate: false,
    worker_input: input,
    protocol: [
      "Renew with the privately held token, current revision, generation and worker_id; persist receipt privately.",
      "Call external_begin with external_ref and bounded operation description; require an acknowledged success. Lost/ambiguous receipt means reread and observation only, never allocation.",
      "Reread dispatch envelope; verify same task/worker/generation/ref, valid lease, no stop and acknowledged revision. An intervening change aborts allocation.",
      "Only in that same uninterrupted acknowledged attempt call allocator.ensure once using the recorded external_ref and worker_id; allocator must enforce owner+work-ref uniqueness; that aggregate job reference covers this task’s effects. Context-only allocation is unsupported.",
      "The worker must not call a second external_begin or create independent effects. Split independent effects into separate approved workflow tasks. Persist/query actual allocator reference, never a fake dispatched flag. An unknown launch reply is unknown; record external_result unknown or wait and do not ensure again.",
      "Renew within five minutes while active. On completion independently inspect artifacts/criteria, then external_result completed and complete; owner/platform gates remain.",
    ],
  });
}
