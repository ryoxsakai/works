import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const script = readFileSync(
  new URL("../scripts-wiki-migrate.mjs", import.meta.url),
  "utf8",
);
const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  existing = "11111111-2222-3333-4444-555555555555";
test("Wiki migration guard rejects missing binding, old DB, duplicate UUID, wrong directory and names", () => {
  const dir = mkdtempSync(join(tmpdir(), "wiki-migration-"));
  try {
    writeFileSync(join(dir, "scripts-wiki-migrate.mjs"), script);
    const base = `[[d1_databases]]\nbinding = "DB"\ndatabase_id = "${existing}"\n`;
    const wiki = `[[d1_databases]]\nbinding = "WIKI_DB"\ndatabase_id = "${id}"\nmigrations_dir = "wiki-migrations"\n`;
    for (const [config, target] of [
      [base, id],
      [base + "# " + wiki.replaceAll("\n", "\n# "), id],
      [base + wiki, existing],
      [base + wiki.replace(id, existing), existing],
      [base + wiki.replace("wiki-migrations", "migrations"), id],
      [base + wiki, "works-wiki-db"],
    ]) {
      writeFileSync(join(dir, "wrangler.toml"), config);
      const r = spawnSync(
        process.execPath,
        [join(dir, "scripts-wiki-migrate.mjs"), "--remote", target],
        { encoding: "utf8" },
      );
      assert.notEqual(r.status, 0);
      assert.ok(!r.stderr.includes("Cannot find module"), r.stderr);
    }
    // A fixture CLI records the local target without accessing Cloudflare.
    mkdirSync(join(dir, "node_modules/wrangler/bin"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules/wrangler/bin/wrangler.js"),
      "console.log(JSON.stringify(process.argv.slice(2)))",
    );
    writeFileSync(join(dir, "wrangler.toml"), base + wiki);
    const r = spawnSync(
      process.execPath,
      [join(dir, "scripts-wiki-migrate.mjs"), "--local", id],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), [
      "d1",
      "migrations",
      "apply",
      id,
      "--local",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
