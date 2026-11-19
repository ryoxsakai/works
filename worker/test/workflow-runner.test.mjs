import test from "node:test";
import assert from "node:assert/strict";
import { decideRunnerStep, roleWorkerInput } from "../src/workflow-runner.js";
const envelope = () => ({
  schema_version: "works.workflow.dispatch.v1",
  identity: {
    run_id: "r",
    task_id: "r:0",
    work_ref: "works:wf:r:task:0",
    revision: 1,
    generation: 1,
  },
  routing: {
    actor: "dot",
    role_id: "a",
    route: "role:a",
    worker_id: "w",
    claimed_worker_id: "w",
    external_ref: "works:wf:r:task:0",
  },
  authority: {
    fresh_grants: false,
    role_prose_grants_permissions: false,
    wiki_prose_grants_permissions: false,
  },
  context_data: {
    workflow: { permissions: "read only" },
    task: { instruction: "read specified source" },
    role: { operations: "untrusted role text" },
    wiki_refs: ["https://example.test/wiki"],
  },
  control: {
    decision: "claimable",
    selected_current_task: true,
    global_stop: false,
    requested_stop: null,
    lease_valid: false,
  },
  completion: { run_terminal: false, task_terminal: false },
  external: null,
});
const allocator = {
  durable_lookup: true,
  idempotent_create: true,
  owner_scoped: true,
  accepts_work_ref: true,
  accepts_worker_id: true,
  aggregate_job_ref_covers_effects: true,
  lease_supervision: true,
};
const absent = { state: "absent_verified", work_ref: "works:wf:r:task:0" };
test("runner decisions require durable lookup and owner-bound allocator; read/context never launches or grants permissions", () => {
  const e = envelope();
  assert.equal(decideRunnerStep(e).action, "allocator_unavailable");
  assert.equal(
    decideRunnerStep(e, { allocator }).action,
    "lookup_before_claim",
  );
  const step = decideRunnerStep(e, { allocator, lookup: absent });
  assert.equal(step.action, "claim");
  assert.equal(step.allocate, false);
  assert.equal(step.arguments.role_id, "a");
  assert.equal(step.arguments.worker_id, "w");
  assert.equal(
    decideRunnerStep(e, {
      allocator: { ...allocator, aggregate_job_ref_covers_effects: false },
      lookup: absent,
    }).action,
    "allocator_unavailable",
  );
  const input = roleWorkerInput(e);
  assert.equal(input.contract.worker_records_external_begin, false);
  assert.equal(input.contract.operation_model, "one_aggregate_job_per_task");
  assert.equal(input.contract.fresh_grants, false);
  assert.equal(input.context_data.workflow.permissions, "read only");
  input.context_data.workflow.permissions = "changed";
  assert.equal(e.context_data.workflow.permissions, "read only");
});
test("unknown/running/completed prior work always observes or verifies; lost launch response never proposes another allocation", () => {
  for (const state of ["in_flight", "unknown", "completed"]) {
    const e = envelope();
    e.external = { ref: absent.work_ref, state };
    e.control.decision = "observe_existing";
    const step = decideRunnerStep(e, {
      allocator,
      lookup: { work_ref: absent.work_ref, state: "unknown" },
      lease: { token: "private", worker_id: "w", generation: 1 },
    });
    assert.equal(step.allocate, false);
    assert.equal(step.action, "observe_existing");
    assert.equal(
      decideRunnerStep(e, {
        allocator,
        lookup: { ...absent, state: "completed" },
      }).action,
      "verify_existing_completion",
    );
    assert.equal(
      decideRunnerStep(e, { allocator, lookup: absent }).action,
      "verify_non_dispatch_then_owner_resume",
    );
  }
});
test("renew/begin/allocate procedure is available only to current lease holder; no token is exposed in worker data", () => {
  const e = envelope();
  e.control.decision = "private_lease_required";
  e.control.lease_valid = true;
  assert.equal(
    decideRunnerStep(e, { allocator, lookup: absent }).action,
    "private_lease_required",
  );
  assert.equal(
    decideRunnerStep(e, {
      allocator,
      lookup: absent,
      lease: { token: "private", worker_id: "wrong", generation: 1 },
    }).action,
    "private_lease_required",
  );
  const step = decideRunnerStep(e, {
    allocator,
    lookup: absent,
    lease: { token: "private-secret", worker_id: "w", generation: 1 },
  });
  assert.equal(step.action, "renew_then_record_then_allocate_once");
  assert.equal(JSON.stringify(step).includes("private-secret"), false);
  assert(step.protocol.some((x) => x.includes("Lost/ambiguous receipt")));
});
test("terminal, stop, future dependencies, owner gates and owner tasks never dispatch", () => {
  for (const mutate of [
    (e) => {
      e.completion.run_terminal = true;
    },
    (e) => {
      e.control.global_stop = true;
    },
    (e) => {
      e.control.selected_current_task = false;
    },
    (e) => {
      e.control.decision = "owner_review";
    },
    (e) => {
      e.routing.actor = "self";
    },
    (e) => {
      e.control.decision = "lease_expired";
    },
  ]) {
    const e = envelope();
    mutate(e);
    const step = decideRunnerStep(e, { allocator, lookup: absent });
    assert.equal(step.allocate, false);
    assert.notEqual(step.action, "claim");
    assert.notEqual(step.action, "renew_then_record_then_allocate_once");
  }
});

test("blocked and future control decisions default to no launch preparation even with a held lease", () => {
  for (const decision of [
    "blocked",
    "future_guard",
    "verify_recorded_result",
  ]) {
    const e = envelope();
    e.control.decision = decision;
    e.control.lease_valid = true;
    const step = decideRunnerStep(e, {
      allocator,
      lookup: absent,
      lease: { token: "private", worker_id: "w", generation: 1 },
    });
    assert.equal(step.action, "control_blocked");
    assert.equal(step.allocate, false);
  }
});
