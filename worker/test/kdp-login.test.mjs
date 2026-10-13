import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("KDP reuses registered tutor callback and consumes only safe pending destinations", async () => {
  const tutor = await readFile(
    new URL("../../tutor/app.js", import.meta.url),
    "utf8",
  );
  const home = await readFile(
    new URL("../../home.js", import.meta.url),
    "utf8",
  );
  const kdp = await readFile(
    new URL("../../kdp/app.js", import.meta.url),
    "utf8",
  );
  assert.match(
    kdp,
    /localStorage\.setItem\("works_pending_destination", "\/kdp\/"\);\s*signIn\("\/tutor\/"\)/,
  );
  assert.ok(!kdp.includes('signIn("/kdp/")'));
  const constants = tutor.match(
    /const PENDING_DESTINATION_KEY =[^;]+;\s*const SAFE_DESTINATION_RE =[^;]+;/,
  )[0];
  const consume = tutor.match(
    /function consumePendingDestination\(\) \{[\s\S]+?\n\}/,
  )[0];
  const homeRegex = new Function(
    "return " + home.match(/const SAFE_DESTINATION_RE = ([^;]+);/)[1],
  )();
  const run = new Function(
    "localStorage",
    constants + "\n" + consume + "\nreturn consumePendingDestination();",
  );
  for (const path of [
    "/wiki/",
    "/kdp/",
    "/todo/",
    "/material-print/",
    "/tutor/",
    "/",
  ]) {
    let removed = false;
    assert.equal(
      run({
        getItem: () => path,
        removeItem: () => {
          removed = true;
        },
      }),
      path,
    );
    assert.equal(homeRegex.test(path), true);
    assert.equal(removed, true);
  }
  for (const path of [
    "/wiki/?folder=folder-1",
    "/wiki/?page=page_2",
    "/wiki/?folder=f-1&page=p-2",
    "/wiki/?page=p-2&folder=f-1",
  ])
    assert.equal(run({ getItem: () => path, removeItem: () => {} }), path);
  for (const path of [
    "/wiki/?page=p&page=q",
    "/wiki/?folder=f&redirect=https://external.test",
    "/wiki/?page=%2F%2Fexternal.test",
    "/wiki/?folder=" + "a".repeat(101),
    "/wiki/?page=p#hash",
    "https://external.test/",
    "//external.test/",
    "/kdp/?redirect=x",
    "/kdp/../todo/",
    "/api/kdp/books",
  ])
    assert.equal(run({ getItem: () => path, removeItem: () => {} }), "");
});
