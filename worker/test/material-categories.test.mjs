import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

async function loadMaterialCategoryFunctions() {
  const sourceUrl = new URL("../src/index.js", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const exposedSource = `${source}\nexport { createSessionToken, createMcpAccessToken, handleMcp, ensureMaterialCategorySchema, readMaterialCategories, createMaterialCategory, updateMaterialCategory, reorderMaterialCategories, readMaterials, createMaterial, updateMaterial, reorderMaterialsInCategory, listMcpMaterialCategories, createMcpMaterialCategory, updateMcpMaterialCategory, reorderMcpMaterialCategories, listMcpCurriculumMaterials, createMcpCurriculumMaterial, moveMcpCurriculumMaterialToCategory, reorderMcpCurriculumMaterialsInCategory };`;
  return import(`data:text/javascript;base64,${Buffer.from(exposedSource).toString("base64")}`);
}

test("material categories migrate existing data and support rename, reorder, and moves", async (context) => {
  const functions = await loadMaterialCategoryFunctions();
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "material-categories-test" },
  });
  context.after(async () => {
    await miniflare.dispose();
  });
  const db = await miniflare.getD1Database("DB");
  await db.prepare(`CREATE TABLE materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.batch([
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
  const toolNames = (await toolsResponse.json()).result.tools.map((tool) => tool.name);
  assert.ok(toolNames.includes("list_material_categories"));
  assert.ok(toolNames.includes("create_material_category"));
  assert.ok(toolNames.includes("update_material_category"));
  assert.ok(toolNames.includes("reorder_material_categories"));
  assert.ok(toolNames.includes("move_curriculum_material_to_category"));
  assert.ok(toolNames.includes("reorder_curriculum_materials_in_category"));

  await db.prepare("INSERT INTO materials (id, name, sort_order) VALUES (1, '既存教材', 0)").run();
  await functions.ensureMaterialCategorySchema(env);
  const { results: columns } = await db.prepare("PRAGMA table_info(materials)").all();
  assert.ok(columns.some((column) => column.name === "category_id"));
  assert.equal((await functions.readMaterials(env))[0].category_id, null);

  const science = await functions.createMaterialCategory(env, { name: "理科" });
  const english = await functions.createMaterialCategory(env, { name: "英語" });
  const duplicateCategory = await functions.createMcpMaterialCategory(env, { name: " 英語 " });
  assert.equal(duplicateCategory.created, false);
  assert.equal(duplicateCategory.category.id, english.id);
  await assert.rejects(
    functions.createMaterialCategory(env, { name: " 英語 " }),
    /already uses this name/
  );

  const reorderedCategories = await functions.reorderMcpMaterialCategories(env, {
    category_ids: [english.id, science.id],
  });
  assert.deepEqual(reorderedCategories.categories.map((category) => category.name), ["英語", "理科"]);
  await assert.rejects(
    functions.reorderMaterialCategories(env, { category_ids: [english.id] }),
    /every current category/
  );

  const vocabulary = await functions.createMaterial(env, {
    name: "英単語",
    category_id: english.id,
  });
  const grammar = await functions.createMaterial(env, {
    name: "英文法",
    category_id: english.id,
  });
  const chemistry = await functions.createMaterial(env, {
    name: "化学",
    category_id: science.id,
  });
  await functions.updateMaterial(env, 1, { category_id: science.id });
  await functions.reorderMaterialsInCategory(env, {
    category_id: english.id,
    material_ids: [grammar.id, vocabulary.id],
  });

  const materials = await functions.readMaterials(env);
  assert.deepEqual(materials.map((material) => material.name), ["英文法", "英単語", "化学", "既存教材"]);
  assert.deepEqual(materials.map((material) => material.category_name), ["英語", "英語", "理科", "理科"]);
  assert.deepEqual(materials.map((material) => material.sort_order), [0, 1, 0, 1]);
  await assert.rejects(
    functions.reorderMaterialsInCategory(env, {
      category_id: english.id,
      material_ids: [vocabulary.id],
    }),
    /every current material/
  );

  const renamedResult = await functions.updateMcpMaterialCategory(env, {
    category_id: science.id,
    name: "理科・実験",
  });
  const renamed = renamedResult.category;
  assert.equal(renamedResult.before.name, "理科");
  assert.equal(renamed.name, "理科・実験");
  assert.equal(Number(renamed.material_count), 2);
  assert.equal(chemistry.category_id, science.id);

  const categoryListing = await functions.listMcpMaterialCategories(env);
  assert.deepEqual(categoryListing.categories.map((category) => category.name), ["英語", "理科・実験"]);
  const mcpMaterial = await functions.createMcpCurriculumMaterial(env, {
    name: "英熟語",
    category_id: english.id,
  });
  assert.equal(mcpMaterial.created, true);
  assert.equal(mcpMaterial.material.category_id, english.id);
  const moved = await functions.moveMcpCurriculumMaterialToCategory(env, {
    material_id: chemistry.id,
    category_id: null,
  });
  assert.equal(moved.moved, true);
  assert.equal(moved.material.category_id, null);
  const movedBack = await functions.moveMcpCurriculumMaterialToCategory(env, {
    material_id: chemistry.id,
    category_id: science.id,
  });
  assert.equal(movedBack.material.category_name, "理科・実験");
  const unchangedMove = await functions.moveMcpCurriculumMaterialToCategory(env, {
    material_id: chemistry.id,
    category_id: science.id,
  });
  assert.equal(unchangedMove.moved, false);
  const mcpReordered = await functions.reorderMcpCurriculumMaterialsInCategory(env, {
    category_id: english.id,
    material_ids: [mcpMaterial.material.id, vocabulary.id, grammar.id],
  });
  assert.deepEqual(mcpReordered.materials.map((material) => material.name), ["英熟語", "英単語", "英文法"]);
  const categorySearch = await functions.listMcpCurriculumMaterials(env, { query: "英語" });
  assert.deepEqual(categorySearch.materials.map((material) => material.name), ["英熟語", "英単語", "英文法"]);

  const apiEnv = {
    DB: db,
    ALLOWED_EMAIL: "owner@example.com",
    SESSION_SECRET: "material-category-test-secret",
  };
  const token = await functions.createSessionToken(apiEnv, apiEnv.ALLOWED_EMAIL);
  const response = await functions.default.fetch(
    new Request("https://works.lrnr.jp/api/material-categories", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    apiEnv
  );
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((category) => category.name), ["英語", "理科・実験"]);

  const mcpToken = await functions.createMcpAccessToken(apiEnv, "schedule:read");
  const mcpCreateResponse = await functions.handleMcp(
    new Request("https://works.lrnr.jp/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mcpToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "create_material_category", arguments: { name: "数学" } },
      }),
    }),
    apiEnv,
    new URL("https://works.lrnr.jp/mcp")
  );
  assert.equal(mcpCreateResponse.status, 200);
  const mcpCreatePayload = await mcpCreateResponse.json();
  assert.equal(mcpCreatePayload.result.structuredContent.category.name, "数学");
  assert.equal(mcpCreatePayload.result.structuredContent.created, true);
});
