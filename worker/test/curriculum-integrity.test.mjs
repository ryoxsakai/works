import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

async function loadCurriculumFunctions() {
  const sourceUrl = new URL("../src/index.js", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const exposedSource = `${source}\nexport { handleMcp, ensureCurriculumIntegrity, listMcpCurriculumMaterials, updateMcpCurriculumMaterial, updateMcpMaterialChapter, reorderMcpMaterialChapters, mergeMcpMaterialChapters, deleteMcpMaterialChapter };`;
  return import(`data:text/javascript;base64,${Buffer.from(exposedSource).toString("base64")}`);
}

async function createDatabase() {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "curriculum-test" },
  });
  const db = await miniflare.getD1Database("DB");
  try {
    await db.batch([
      db.prepare(`CREATE TABLE materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
      )`),
      db.prepare(`CREATE TABLE material_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
      )`),
      db.prepare(`CREATE TABLE student_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      material_id INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
      )`),
      db.prepare(`CREATE TABLE chapter_progress (
      name TEXT NOT NULL,
      chapter_id INTEGER NOT NULL,
      completed INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (name, chapter_id)
      )`),
    ]);
  } catch (error) {
    await miniflare.dispose();
    throw error;
  }
  return { miniflare, db };
}

test("curriculum tools merge duplicates, preserve progress, and guard destructive edits", async (context) => {
  const functions = await loadCurriculumFunctions();
  const { miniflare, db } = await createDatabase();
  context.after(async () => {
    await miniflare.dispose();
  });
  const env = { DB: db };

  const toolsResponse = await functions.handleMcp(
    new Request("https://works.lrnr.jp/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    }),
    env,
    new URL("https://works.lrnr.jp/mcp")
  );
  const toolsPayload = await toolsResponse.json();
  const toolNames = toolsPayload.result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("update_material_chapter"));
  assert.ok(toolNames.includes("reorder_material_chapters"));
  assert.ok(toolNames.includes("merge_material_chapters"));
  assert.ok(toolNames.includes("delete_material_chapter"));

  await db.prepare("INSERT INTO materials (id, name, sort_order) VALUES (1, 'Target 1900', 0)").run();
  await db.prepare("INSERT INTO material_chapters (id, material_id, name, sort_order) VALUES (8, 1, 'Unit 08', 7)").run();
  await db.prepare("INSERT INTO material_chapters (id, material_id, name, sort_order) VALUES (9, 1, ' unit 08 ', 7)").run();
  await db.prepare("INSERT INTO material_chapters (id, material_id, name, sort_order) VALUES (10, 1, 'Unit 09', 8)").run();
  await db.prepare("INSERT INTO material_chapters (id, material_id, name, sort_order) VALUES (11, 1, 'Unit 10', 9)").run();
  await db.prepare("INSERT INTO chapter_progress (name, chapter_id, completed) VALUES ('Alice', 8, 0)").run();
  await db.prepare("INSERT INTO chapter_progress (name, chapter_id, completed) VALUES ('Alice', 9, 1)").run();
  await db.prepare("INSERT INTO chapter_progress (name, chapter_id, completed) VALUES ('Bob', 9, 1)").run();

  const cleanup = await functions.ensureCurriculumIntegrity(env);
  assert.deepEqual(cleanup.merged_chapters.map((item) => [item.source_chapter_id, item.target_chapter_id]), [[9, 8]]);
  const afterCleanup = await functions.listMcpCurriculumMaterials(env);
  assert.deepEqual(afterCleanup.materials[0].chapters.map((chapter) => chapter.id), [8, 10, 11]);
  assert.deepEqual(afterCleanup.materials[0].chapters.map((chapter) => chapter.sort_order), [0, 1, 2]);
  assert.equal((await db.prepare("SELECT completed FROM chapter_progress WHERE name = 'Alice' AND chapter_id = 8").first()).completed, 1);
  assert.equal((await db.prepare("SELECT completed FROM chapter_progress WHERE name = 'Bob' AND chapter_id = 8").first()).completed, 1);
  assert.equal(await db.prepare("SELECT id FROM material_chapters WHERE id = 9").first(), null);
  await assert.rejects(
    db.prepare("INSERT INTO material_chapters (material_id, name, sort_order) VALUES (1, 'UNIT 08', 3)").run()
  );

  const renamedMaterial = await functions.updateMcpCurriculumMaterial(env, { material_id: 1, name: "Target 1900 見出し語" });
  assert.equal(renamedMaterial.material.name, "Target 1900 見出し語");
  const renamedChapter = await functions.updateMcpMaterialChapter(env, { chapter_id: 10, name: "Unit 09 改訂" });
  assert.equal(renamedChapter.chapter.name, "Unit 09 改訂");

  const reordered = await functions.reorderMcpMaterialChapters(env, { material_id: 1, chapter_ids: [11, 10, 8] });
  assert.deepEqual(reordered.chapters.map((chapter) => chapter.id), [11, 10, 8]);
  await assert.rejects(
    functions.reorderMcpMaterialChapters(env, { material_id: 1, chapter_ids: [11, 10] }),
    /every current chapter/
  );

  await db.prepare("INSERT INTO chapter_progress (name, chapter_id, completed) VALUES ('Charlie', 10, 0)").run();
  await db.prepare("INSERT INTO chapter_progress (name, chapter_id, completed) VALUES ('Charlie', 11, 1)").run();
  const merged = await functions.mergeMcpMaterialChapters(env, {
    source_chapter_id: 11,
    target_chapter_id: 10,
    expected_source_name: "Unit 10",
  });
  assert.equal(merged.merged, true);
  assert.equal((await db.prepare("SELECT completed FROM chapter_progress WHERE name = 'Charlie' AND chapter_id = 10").first()).completed, 1);
  assert.equal(await db.prepare("SELECT id FROM material_chapters WHERE id = 11").first(), null);

  await assert.rejects(
    functions.deleteMcpMaterialChapter(env, { chapter_id: 8, expected_name: "Unit 08" }),
    /has student progress/
  );
  await db.prepare("INSERT INTO material_chapters (id, material_id, name, sort_order) VALUES (12, 1, 'Temporary', 2)").run();
  const deleted = await functions.deleteMcpMaterialChapter(env, { chapter_id: 12, expected_name: "Temporary" });
  assert.equal(deleted.deleted, true);
  assert.equal(await db.prepare("SELECT id FROM material_chapters WHERE id = 12").first(), null);
});
