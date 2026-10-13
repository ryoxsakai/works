const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const revision = (value) => {
  if (!Number.isSafeInteger(value) || value < 1)
    fail(400, "revision is required");
  return value;
};
const id = (value) => {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !value || value.length > 100)
    fail(400, "folder_id is invalid");
  return value;
};
export async function folderTarget(database, value, expected) {
  const target = id(value);
  if (target === null) return null;
  const f = await database
    .prepare("SELECT id,revision FROM wiki_folders WHERE id=?")
    .bind(target)
    .first();
  if (!f) fail(400, "移動先フォルダが存在しません。");
  if (expected !== undefined && f.revision !== revision(expected))
    fail(409, "移動先フォルダが変更されています。再読込してください。");
  return target;
}
export async function listWikiFolders(database) {
  const rows = await database
    .prepare(
      "SELECT id,parent_id,name,revision,updated_at FROM wiki_folders ORDER BY name,id LIMIT 1001",
    )
    .all();
  if (rows.results.length > 1000) fail(413, "フォルダ数の上限を超えています。");
  const pages = await database
    .prepare(
      "SELECT id,title,folder_id,revision,archived FROM wiki_pages ORDER BY updated_at DESC,id LIMIT 2001",
    )
    .all();
  return {
    folders: rows.results,
    pages: pages.results.slice(0, 2000),
    pages_truncated: pages.results.length > 2000,
  };
}
export async function writeWikiFolder(database, folderId, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(400, "folder input is required");
  const name = input.name;
  if (typeof name !== "string" || !name.trim() || name.length > 200)
    fail(400, "フォルダ名は1〜200文字で入力してください。");
  const parent = await folderTarget(
    database,
    input.parent_id ?? null,
    input.parent_revision,
  );
  if (parent !== null) revision(input.parent_revision);
  const targetCondition =
    parent === null
      ? ""
      : " AND EXISTS(SELECT 1 FROM wiki_folders WHERE id=? AND revision=?)";
  const targetArgs = parent === null ? [] : [parent, input.parent_revision];
  let result;
  try {
    if (folderId) {
      result = await database
        .prepare(
          `UPDATE wiki_folders SET name=?,parent_id=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=?${targetCondition} RETURNING *`,
        )
        .bind(
          name.trim(),
          parent,
          folderId,
          revision(input.revision),
          ...targetArgs,
        )
        .first();
    } else {
      result = await database
        .prepare(
          `INSERT INTO wiki_folders(id,name,parent_id) SELECT ?,?,? WHERE (SELECT count(*) FROM wiki_folders)<1000${targetCondition} RETURNING *`,
        )
        .bind(crypto.randomUUID(), name.trim(), parent, ...targetArgs)
        .first();
    }
  } catch (error) {
    if (
      /cycle|depth|FOREIGN KEY|UNIQUE constraint|CHECK constraint/i.test(
        error.message,
      )
    )
      fail(
        409,
        "フォルダの循環・深すぎる階層・変更された移動先は使用できません。",
      );
    throw error;
  }
  if (!result)
    fail(
      409,
      "フォルダが変更されたか、上限に達しています。再読込してください。",
    );
  return { folder: result };
}
export async function moveWikiPage(database, pageId, input) {
  const target = await folderTarget(
    database,
    input.folder_id,
    input.folder_revision,
  );
  if (target !== null) revision(input.folder_revision);
  const row = await database
    .prepare(
      `UPDATE wiki_pages SET folder_id=?,revision=revision+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND revision=? AND archived=0${target === null ? "" : " AND EXISTS(SELECT 1 FROM wiki_folders WHERE id=? AND revision=?)"} RETURNING id`,
    )
    .bind(
      target,
      pageId,
      revision(input.revision),
      ...(target === null ? [] : [target, input.folder_revision]),
    )
    .first();
  if (!row)
    fail(409, "ページまたは移動先が変更されています。再読込してください。");
}
