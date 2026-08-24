import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";

async function loadMaterialCategoryFunctions() {
  const sourceUrl = new URL("../src/index.js", import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  const exposedSource = `${source}\nexport { createSessionToken, ensureMaterialCategorySchema, readMaterialCategories, createMaterialCategory, updateMaterialCategory, reorderMaterialCategories, readMaterials, createMaterial, updateMaterial, reorderMaterialsInCategory };`;
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
  const env = { DB: db };

  await db.prepare("INSERT INTO materials (id, name, sort_order) VALUES (1, '既存教材', 0)").run();
  await functions.ensureMaterialCategorySchema(env);
  const { results: columns } = await db.prepare("PRAGMA table_info(materials)").all();
  assert.ok(columns.some((column) => column.name === "category_id"));
  assert.equal((await functions.readMaterials(env))[0].category_id, null);

  const science = await functions.createMaterialCategory(env, { name: "理科" });
  const english = await functions.createMaterialCategory(env, { name: "英語" });
  await assert.rejects(
    functions.createMaterialCategory(env, { name: " 英語 " }),
    /already uses this name/
  );

  const reorderedCategories = await functions.reorderMaterialCategories(env, {
    category_ids: [english.id, science.id],
  });
  assert.deepEqual(reorderedCategories.map((category) => category.name), ["英語", "理科"]);
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

  const renamed = await functions.updateMaterialCategory(env, science.id, { name: "理科・実験" });
  assert.equal(renamed.name, "理科・実験");
  assert.equal(Number(renamed.material_count), 2);
  assert.equal(chemistry.category_id, science.id);

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
});
