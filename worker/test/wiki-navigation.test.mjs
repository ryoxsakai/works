import { test } from "node:test";
import assert from "node:assert/strict";
import { navigationParents } from "../../wiki/hierarchy.mjs";
test("navigation exposes orphans and cycles without changing stored hierarchy", () => {
  const folders = [
    { id: "a", parent_id: "b" },
    { id: "b", parent_id: "a" },
    { id: "child", parent_id: "b" },
    { id: "orphan", parent_id: "missing" },
    { id: "self", parent_id: "self" },
    { id: "root", parent_id: null },
  ];
  const original = structuredClone(folders),
    parents = navigationParents(folders);
  assert.deepEqual(folders, original);
  assert.equal(parents.get("orphan"), null);
  assert.equal(parents.get("self"), null);
  for (const f of folders) {
    const seen = new Set();
    let id = f.id;
    while (id !== null) {
      assert.ok(!seen.has(id), "every folder reaches a visible root");
      seen.add(id);
      id = parents.get(id);
    }
  }
  assert.equal(parents.get("child"), "b");
});
test("valid deep hierarchy retains all parents", () => {
  const folders = Array.from({ length: 100 }, (_, i) => ({
    id: String(i),
    parent_id: i ? String(i - 1) : null,
  }));
  assert.deepEqual(
    [...navigationParents(folders)],
    folders.map((f) => [f.id, f.parent_id]),
  );
});
