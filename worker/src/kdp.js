import { commitKdpMutation } from "./kdp-mutations.js";

export const KDP_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS kdp_books (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', subtitle TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'en', audience TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE TABLE IF NOT EXISTS kdp_chapters (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES kdp_books(id), title TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE TABLE IF NOT EXISTS kdp_sections (id TEXT PRIMARY KEY, chapter_id TEXT NOT NULL REFERENCES kdp_chapters(id), title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE TABLE IF NOT EXISTS kdp_history (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(entity_type,entity_id,revision));",
  "CREATE TRIGGER IF NOT EXISTS kdp_books_insert AFTER INSERT ON kdp_books BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('books',NEW.id,NEW.revision,json_object('id',NEW.id, 'title',NEW.title, 'subtitle',NEW.subtitle, 'author',NEW.author, 'language',NEW.language, 'audience',NEW.audience, 'description',NEW.description, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_books_update AFTER UPDATE ON kdp_books BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('books',NEW.id,NEW.revision,json_object('id',NEW.id, 'title',NEW.title, 'subtitle',NEW.subtitle, 'author',NEW.author, 'language',NEW.language, 'audience',NEW.audience, 'description',NEW.description, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_chapters_insert AFTER INSERT ON kdp_chapters BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('chapters',NEW.id,NEW.revision,json_object('id',NEW.id, 'book_id',NEW.book_id, 'title',NEW.title, 'sort_order',NEW.sort_order, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_chapters_update AFTER UPDATE ON kdp_chapters BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('chapters',NEW.id,NEW.revision,json_object('id',NEW.id, 'book_id',NEW.book_id, 'title',NEW.title, 'sort_order',NEW.sort_order, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_sections_insert AFTER INSERT ON kdp_sections BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('sections',NEW.id,NEW.revision,json_object('id',NEW.id, 'chapter_id',NEW.chapter_id, 'title',NEW.title, 'body',NEW.body, 'sort_order',NEW.sort_order, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_sections_update AFTER UPDATE ON kdp_sections BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('sections',NEW.id,NEW.revision,json_object('id',NEW.id, 'chapter_id',NEW.chapter_id, 'title',NEW.title, 'body',NEW.body, 'sort_order',NEW.sort_order, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_history_no_update BEFORE UPDATE ON kdp_history BEGIN SELECT RAISE(ABORT,'KDP history is immutable'); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_history_no_delete BEFORE DELETE ON kdp_history BEGIN SELECT RAISE(ABORT,'KDP history is immutable'); END;",
  "CREATE TABLE IF NOT EXISTS kdp_sources (id TEXT PRIMARY KEY, section_id TEXT NOT NULL REFERENCES kdp_sections(id), url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', checked_at TEXT NOT NULL DEFAULT '', target_year TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE TABLE IF NOT EXISTS kdp_proposals (id TEXT PRIMARY KEY, section_id TEXT NOT NULL REFERENCES kdp_sections(id), body TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', base_revision INTEGER NOT NULL, base_body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));",
  "CREATE INDEX IF NOT EXISTS kdp_chapters_book ON kdp_chapters(book_id,sort_order);",
  "CREATE INDEX IF NOT EXISTS kdp_sections_chapter ON kdp_sections(chapter_id,sort_order);",
  "CREATE INDEX IF NOT EXISTS kdp_sources_section ON kdp_sources(section_id);",
  "CREATE INDEX IF NOT EXISTS kdp_proposals_section ON kdp_proposals(section_id);",
  "CREATE TRIGGER IF NOT EXISTS kdp_sources_insert AFTER INSERT ON kdp_sources BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('sources',NEW.id,NEW.revision,json_object('id',NEW.id, 'section_id',NEW.section_id, 'url',NEW.url, 'title',NEW.title, 'checked_at',NEW.checked_at, 'target_year',NEW.target_year, 'notes',NEW.notes, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_sources_update AFTER UPDATE ON kdp_sources BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('sources',NEW.id,NEW.revision,json_object('id',NEW.id, 'section_id',NEW.section_id, 'url',NEW.url, 'title',NEW.title, 'checked_at',NEW.checked_at, 'target_year',NEW.target_year, 'notes',NEW.notes, 'archived',NEW.archived, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_proposals_insert AFTER INSERT ON kdp_proposals BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('proposals',NEW.id,NEW.revision,json_object('id',NEW.id, 'section_id',NEW.section_id, 'body',NEW.body, 'title',NEW.title, 'notes',NEW.notes, 'base_revision',NEW.base_revision, 'base_body',NEW.base_body, 'status',NEW.status, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
  "CREATE TRIGGER IF NOT EXISTS kdp_proposals_update AFTER UPDATE ON kdp_proposals BEGIN INSERT INTO kdp_history(entity_type,entity_id,revision,snapshot) VALUES ('proposals',NEW.id,NEW.revision,json_object('id',NEW.id, 'section_id',NEW.section_id, 'body',NEW.body, 'title',NEW.title, 'notes',NEW.notes, 'base_revision',NEW.base_revision, 'base_body',NEW.base_body, 'status',NEW.status, 'revision',NEW.revision, 'created_at',NEW.created_at, 'updated_at',NEW.updated_at)); END;",
];
export async function ensureKdpSchema(db) {
  await db.batch(KDP_SCHEMA.map((sql) => db.prepare(sql)));
}
const fail = (status, message) => {
  throw Object.assign(new Error(message), {
    status,
  });
};
const fields = {
  books: [
    "title",
    "subtitle",
    "author",
    "language",
    "audience",
    "description",
    "archived",
  ],
  chapters: ["title", "sort_order", "archived"],
  sections: ["title", "body", "sort_order", "archived"],
  sources: ["url", "title", "checked_at", "target_year", "notes", "archived"],
};
const text = (v, key, max = 200000) => {
  if (typeof v !== "string" || v.length > max)
    fail(400, `${key} must be text (maximum ${max} characters)`);
  return v;
};
function validate(data, keys) {
  const out = {};
  for (const key of keys)
    if (data[key] !== undefined) {
      const v = data[key];
      if (key === "archived") {
        if (![true, false, 0, 1].includes(v))
          fail(400, "archived must be boolean");
        out[key] = Number(v);
      } else if (key === "sort_order") {
        if (!Number.isSafeInteger(v))
          fail(400, "sort_order must be an integer");
        out[key] = v;
      } else {
        out[key] = text(
          v,
          key,
          key === "body"
            ? 200000
            : key === "title" || key === "subtitle" || key === "author"
              ? 300
              : 20000,
        );
        if (key === "url") {
          try {
            const u = new URL(v);
            if (!["http:", "https:"].includes(u.protocol)) throw Error();
          } catch {
            fail(400, "Source URL must use HTTP or HTTPS");
          }
        }
      }
    }
  return out;
}
function revision(v) {
  if (!Number.isSafeInteger(v) || v < 1)
    fail(400, "revision must be a positive integer");
  return v;
}
async function row(db, type, id) {
  const r = await db
    .prepare(`SELECT * FROM kdp_${type} WHERE id=?`)
    .bind(id)
    .first();
  if (!r) fail(404, `${type} not found`);
  return r;
}
async function list(db, sql, ...args) {
  return (
    await db
      .prepare(sql)
      .bind(...args)
      .all()
  ).results;
}
export async function readBooks(env) {
  await ensureKdpSchema(env.DB);
  return {
    books: await list(
      env.DB,
      "SELECT * FROM kdp_books ORDER BY archived,updated_at DESC,id",
    ),
  };
}
export async function readBook(env, id) {
  await ensureKdpSchema(env.DB);
  const book = await row(env.DB, "books", id);
  const chapters = await list(
    env.DB,
    "SELECT * FROM kdp_chapters WHERE book_id=? ORDER BY sort_order,id",
    id,
  );
  for (const ch of chapters)
    ch.sections = await list(
      env.DB,
      "SELECT * FROM kdp_sections WHERE chapter_id=? ORDER BY sort_order,id",
      ch.id,
    );
  return {
    book,
    chapters,
  };
}
export async function getSection(env, id) {
  await ensureKdpSchema(env.DB);
  const section = await row(env.DB, "sections", id);
  const [sources, proposals, history] = await env.DB.batch([
    env.DB.prepare(
      "SELECT * FROM kdp_sources WHERE section_id=? ORDER BY created_at DESC,id",
    ).bind(id),
    env.DB.prepare(
      "SELECT * FROM kdp_proposals WHERE section_id=? ORDER BY created_at DESC,id LIMIT 20",
    ).bind(id),
    env.DB.prepare(
      "SELECT revision,created_at FROM kdp_history WHERE entity_type='sections' AND entity_id=? ORDER BY revision DESC LIMIT 100",
    ).bind(id),
  ]);
  return {
    section,
    sources: sources.results,
    proposals: proposals.results,
    history: history.results,
  };
}
export async function readSectionHistory(
  db,
  id,
  searchParams = new URLSearchParams(),
) {
  const limitValue = searchParams.get("limit");
  const beforeValue = searchParams.get("before_revision");
  const integerParam = (value, name) => {
    if (!/^\d+$/.test(value)) fail(400, `${name} must be a positive integer`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1)
      fail(400, `${name} must be a positive integer`);
    return number;
  };
  const limit = limitValue === null ? 10 : integerParam(limitValue, "limit");
  if (limit > 20) fail(400, "limit must be at most 20");
  const before =
    beforeValue === null ? null : integerParam(beforeValue, "before_revision");
  const query =
    "SELECT revision,snapshot,created_at FROM kdp_history WHERE entity_type='sections' AND entity_id=?" +
    (before === null ? "" : " AND revision<?") +
    " ORDER BY revision DESC LIMIT ?";
  const history = await list(
    db,
    query,
    id,
    ...(before === null ? [] : [before]),
    limit + 1,
  );
  const hasMore = history.length > limit;
  if (hasMore) history.pop();
  return {
    history,
    next_before_revision: hasMore ? history[history.length - 1].revision : null,
  };
}

async function assertActive(db, type, id) {
  const item = await row(db, type, id);
  if (item.archived) fail(409, "Item is archived; restore it before editing");
  if (type === "chapters") await assertActive(db, "books", item.book_id);
  if (type === "sections") await assertActive(db, "chapters", item.chapter_id);
  if (type === "sources") await assertActive(db, "sections", item.section_id);
  return item;
}
// Correlated guards also enforce archive state inside the atomic write.
function activeParent(type) {
  if (type === "chapters")
    return "EXISTS (SELECT 1 FROM kdp_books b WHERE b.id=kdp_chapters.book_id AND b.archived=0)";
  if (type === "sections")
    return "EXISTS (SELECT 1 FROM kdp_chapters c JOIN kdp_books b ON b.id=c.book_id WHERE c.id=kdp_sections.chapter_id AND c.archived=0 AND b.archived=0)";
  if (type === "sources")
    return "EXISTS (SELECT 1 FROM kdp_sections s JOIN kdp_chapters c ON c.id=s.chapter_id JOIN kdp_books b ON b.id=c.book_id WHERE s.id=kdp_sources.section_id AND s.archived=0 AND c.archived=0 AND b.archived=0)";
  return "1=1";
}
async function create(db, type, data, parent, receipt, parentRevision) {
  const values = validate(data, fields[type]);
  if (type === "sources" && !values.url) fail(400, "Source URL is required");
  if (parent) {
    const currentParent = await assertActive(
      db,
      parent.key === "book_id"
        ? "books"
        : parent.key === "chapter_id"
          ? "chapters"
          : "sections",
      parent.id,
    );
    if (parentRevision !== undefined) {
      revision(parentRevision);
      if (currentParent.revision !== parentRevision)
        fail(409, "Parent revision conflict; reload before creating");
    }
    values[parent.key] = parent.id;
    const count = await db
      .prepare(`SELECT count(*) AS n FROM kdp_${type} WHERE ${parent.key}=?`)
      .bind(parent.id)
      .first();
    if (count.n >= 1000) fail(400, "Maximum 1000 items per parent reached");
  } else if (type === "books") {
    const count = await db
      .prepare("SELECT count(*) AS n FROM kdp_books")
      .first();
    if (count.n >= 1000) fail(400, "Maximum 1000 books reached");
  }
  const id = crypto.randomUUID();
  const keys = ["id", ...Object.keys(values)];
  let guard = parent
    ? activeParent(type).replace(`kdp_${type}.${parent.key}`, "?")
    : "1=1";
  const args = [id, ...Object.values(values), ...(parent ? [parent.id] : [])];
  // Recheck quotas and the caller's parent revision inside the same write.
  guard += parent
    ? ` AND (SELECT count(*) FROM kdp_${type} WHERE ${parent.key}=?)<1000`
    : " AND (SELECT count(*) FROM kdp_books)<1000";
  if (parent) args.push(parent.id);
  if (parentRevision !== undefined) {
    const parentType = parent.key === "book_id" ? "books" : "chapters";
    guard += ` AND EXISTS (SELECT 1 FROM kdp_${parentType} WHERE id=? AND revision=?)`;
    args.push(parent.id, parentRevision);
  }
  const statement = db.prepare(
      `INSERT INTO kdp_${type} (${keys.join(",")}) SELECT ${keys.map(() => "?").join(",")} WHERE ${guard} RETURNING id`,
    )
    .bind(...args);
  const result = await commitKdpMutation(db, [statement], receipt, [
    { key: type.slice(0, -1), type, id, revision: 1 },
  ]);
  if (result.replay) return result.replay[type.slice(0, -1)];
  if (!result.results[0].results[0])
    fail(409, "Parent revision, archive state or item limit changed; reload before creating");
  return row(db, type, id);
}
export async function createKdpEntity(env, type, data, parent, receipt, parentRevision) {
  await ensureKdpSchema(env.DB);
  return { [type.slice(0, -1)]: await create(env.DB, type, data, parent, receipt, parentRevision) };
}
async function update(db, type, id, data) {
  revision(data.revision);
  const current = await row(db, type, id);
  if (type === "chapters") await assertActive(db, "books", current.book_id);
  if (type === "sections")
    await assertActive(db, "chapters", current.chapter_id);
  if (type === "sources")
    await assertActive(db, "sections", current.section_id);
  if (current.archived && data.archived !== false && data.archived !== 0)
    fail(409, "Item is archived; restore it before editing");
  const values = validate(data, fields[type]);
  if (!Object.keys(values).length) fail(400, "No editable fields provided");
  const keys = Object.keys(values);
  const result = await db
    .prepare(
      `UPDATE kdp_${type} SET ${keys.map((k) => `${k}=?`).join(",")},revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND ${activeParent(type)} RETURNING *`,
    )
    .bind(...Object.values(values), id, data.revision)
    .first();
  if (!result) {
    await row(db, type, id);
    fail(409, "Revision conflict; reload before saving");
  }
  return result;
}
export async function reorderKdp(env, parentType, parentId, data) {
  await ensureKdpSchema(env.DB);
  const type = parentType === "books" ? "chapters" : "sections";
  const parentKey = parentType === "books" ? "book_id" : "chapter_id";
  const items = data[type];
  if (!Array.isArray(items) || items.length > 1000)
    fail(400, `${type} must be an array of at most 1000 items`);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id))
      fail(400, "Each sibling ID must appear exactly once");
    revision(item.revision);
    ids.add(item.id);
  }
  await assertActive(env.DB, parentType, parentId);
  // A materialized CTE freezes the complete eligibility check before any row changes.
  // One UPDATE means SQLite cannot commit a partially reordered sibling list.
  const sql = `WITH expected AS MATERIALIZED (
      SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.revision') AS revision,CAST(key AS INTEGER)*1024 AS position FROM json_each(?)
    ), eligible AS MATERIALIZED (
      SELECT CASE WHEN
        (SELECT count(*) FROM kdp_${type} WHERE ${parentKey}=? AND archived=0)=(SELECT count(*) FROM expected)
        AND NOT EXISTS (SELECT 1 FROM expected e LEFT JOIN kdp_${type} t ON t.id=e.id WHERE t.id IS NULL OR t.${parentKey}<>? OR t.archived<>0 OR t.revision<>e.revision)
        AND EXISTS (SELECT 1 FROM kdp_${parentType} WHERE id=? AND archived=0 AND ${activeParent(parentType)})
      THEN 1 ELSE 0 END AS allowed
    )
    UPDATE kdp_${type} SET sort_order=(SELECT position FROM expected WHERE expected.id=kdp_${type}.id),revision=revision+1,updated_at=datetime('now')
    WHERE ${parentKey}=? AND archived=0 AND (SELECT allowed FROM eligible)=1 RETURNING *`;
  const result = await env.DB.prepare(sql)
    .bind(JSON.stringify(items), parentId, parentId, parentId, parentId)
    .all();
  if (result.results.length !== items.length)
    fail(
      409,
      "Sibling revisions or archive state changed; reload before reordering",
    );
  // Empty arrays require the same exact-sibling check, even though UPDATE has no rows.
  if (!items.length) {
    const count = await env.DB.prepare(
      `SELECT count(*) AS n FROM kdp_${type} WHERE ${parentKey}=? AND archived=0`,
    )
      .bind(parentId)
      .first();
    if (count.n) fail(409, "Sibling list changed; reload before reordering");
  }
  return { [type]: result.results.sort((a, b) => a.sort_order - b.sort_order) };
}
export async function createProposal(env, id, data) {
  await ensureKdpSchema(env.DB);
  const s = await assertActive(env.DB, "sections", id);
  revision(data.base_revision);
  if (s.revision !== data.base_revision)
    fail(409, "Revision conflict; reload before proposing");
  if (s.archived) fail(409, "Section is archived");
  const body = text(data.body, "body");
  const title = data.title === undefined ? "" : text(data.title, "title", 300),
    notes = data.notes === undefined ? "" : text(data.notes, "notes", 20000);
  const pid = crypto.randomUUID();
  const r = await env.DB.prepare(
    "INSERT INTO kdp_proposals(id,section_id,body,title,notes,base_revision,base_body) SELECT ?,id,?,?,?,revision,body FROM kdp_sections WHERE id=? AND revision=? AND archived=0 AND EXISTS (SELECT 1 FROM kdp_chapters c JOIN kdp_books b ON b.id=c.book_id WHERE c.id=kdp_sections.chapter_id AND c.archived=0 AND b.archived=0) RETURNING *",
  )
    .bind(pid, body, title, notes, id, data.base_revision)
    .first();
  if (!r) fail(409, "Revision conflict; reload before proposing");
  return {
    proposal: r,
  };
}
async function decide(db, id, data, accept, receipt) {
  revision(data.revision);
  const p = await row(db, "proposals", id);
  if (p.revision !== data.revision || p.status !== "pending")
    fail(409, "Proposal already changed");
  if (data.base_revision !== undefined) {
    revision(data.base_revision);
    if (data.base_revision !== p.base_revision)
      fail(409, "Proposal base revision mismatch; read the section before deciding");
  }
  if (!accept) {
    const result = await commitKdpMutation(db, [db
      .prepare(
        "UPDATE kdp_proposals SET status='rejected',revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status='pending' RETURNING *",
      )
      .bind(id, data.revision)], receipt, [
        { key: "proposal", type: "proposals", id, revision: data.revision + 1 },
      ]);
    if (result.replay) return result.replay;
    const r = result.results[0].results[0];
    if (!r) fail(409, "Proposal already changed");
    return {
      proposal: r,
    };
  }
  await assertActive(db, "sections", p.section_id);
  const committed = await commitKdpMutation(db, [
    db
      .prepare(
        "UPDATE kdp_sections SET body=?,revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND archived=0 AND EXISTS (SELECT 1 FROM kdp_chapters c JOIN kdp_books b ON b.id=c.book_id WHERE c.id=kdp_sections.chapter_id AND c.archived=0 AND b.archived=0) AND EXISTS (SELECT 1 FROM kdp_proposals WHERE id=? AND revision=? AND status='pending') RETURNING *",
      )
      .bind(p.body, p.section_id, p.base_revision, id, data.revision),
    db
      .prepare(
        "UPDATE kdp_proposals SET status='accepted',revision=revision+1,updated_at=datetime('now') WHERE id=? AND revision=? AND status='pending' AND changes()=1 RETURNING *",
      )
      .bind(id, data.revision),
  ], receipt, [
    { key: "section", type: "sections", id: p.section_id, revision: p.base_revision + 1 },
    { key: "proposal", type: "proposals", id, revision: data.revision + 1 },
  ]);
  if (committed.replay) return committed.replay;
  const result = committed.results;
  const section = result[0].results?.[0],
    proposal = result[1].results?.[0];
  if (!section || !proposal)
    fail(409, "Base revision changed; create a new proposal");
  return {
    section,
    proposal,
  };
}
export async function decideKdpProposal(env, id, data, accept, receipt) {
  await ensureKdpSchema(env.DB);
  return decide(env.DB, id, data, accept, receipt);
}
export const KDP_EXPORT_PREFLIGHT_SQL = `WITH chapter_ids AS (SELECT id FROM kdp_chapters WHERE book_id=?),
  section_ids AS (SELECT id FROM kdp_sections WHERE chapter_id IN (SELECT id FROM chapter_ids)),
  source_ids AS (SELECT id FROM kdp_sources WHERE section_id IN (SELECT id FROM section_ids)),
  proposal_ids AS (SELECT id FROM kdp_proposals WHERE section_id IN (SELECT id FROM section_ids))
  SELECT COALESCE(SUM(4*length(CAST(snapshot AS BLOB))+2048),0) AS estimated_bytes FROM kdp_history
  WHERE (entity_type='books' AND entity_id=?)
    OR (entity_type='chapters' AND entity_id IN (SELECT id FROM chapter_ids))
    OR (entity_type='sections' AND entity_id IN (SELECT id FROM section_ids))
    OR (entity_type='sources' AND entity_id IN (SELECT id FROM source_ids))
    OR (entity_type='proposals' AND entity_id IN (SELECT id FROM proposal_ids))`;

export const KDP_CURRENT_EXPORT_SIZE_SQL = `WITH chapter_ids AS (SELECT id FROM kdp_chapters WHERE book_id=?)
 SELECT
   COALESCE((SELECT SUM(length(CAST(json_object('title',title,'subtitle',subtitle,'author',author,'language',language,'audience',audience,'description',description) AS BLOB))+512) FROM kdp_books WHERE id=?),0)
   + COALESCE((SELECT SUM(length(CAST(json_object('title',title,'sort_order',sort_order) AS BLOB))+512) FROM kdp_chapters WHERE book_id=?),0)
   + COALESCE((SELECT SUM(length(CAST(json_object('title',title,'body',body,'sort_order',sort_order) AS BLOB))+512) FROM kdp_sections WHERE chapter_id IN (SELECT id FROM chapter_ids)),0) AS estimated_bytes`;

export async function exportCurrentBook(env, id) {
  await ensureKdpSchema(env.DB);
  // Publication output depends only on the current manuscript, never revision history.
  const size = await env.DB.prepare(KDP_CURRENT_EXPORT_SIZE_SQL)
    .bind(id, id, id)
    .first();
  if (size.estimated_bytes > 8 * 1024 * 1024)
    fail(413, "Current manuscript exceeds the 8 MB export limit");
  const result = await env.DB.batch([
    env.DB.prepare("SELECT * FROM kdp_books WHERE id=?").bind(id),
    env.DB.prepare(
      "SELECT * FROM kdp_chapters WHERE book_id=? ORDER BY sort_order,id",
    ).bind(id),
    env.DB.prepare(
      "SELECT s.* FROM kdp_sections s JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=? ORDER BY s.sort_order,s.id",
    ).bind(id),
  ]);
  const [books, chapters, sections] = result.map((r) => r.results);
  if (!books.length) fail(404, "books not found");
  for (const chapter of chapters)
    chapter.sections = sections.filter(
      (section) => section.chapter_id === chapter.id,
    );
  const manuscript = { book: books[0], chapters };
  if (
    new TextEncoder().encode(JSON.stringify(manuscript)).byteLength >
    8 * 1024 * 1024
  )
    fail(413, "Current manuscript exceeds the 8 MB export limit");
  return manuscript;
}

export async function exportBook(env, id) {
  await ensureKdpSchema(env.DB);
  // Count UTF-8 bytes in SQL before transferring manuscript/history strings to the Worker.
  // Fourfold allowance covers current rows, duplicated section histories and JSON escaping.
  const size = await env.DB.prepare(KDP_EXPORT_PREFLIGHT_SQL)
    .bind(id, id)
    .first();
  if (size.estimated_bytes > 8 * 1024 * 1024)
    fail(413, "Book backup exceeds the conservative 8 MB export limit");
  // D1 batch runs as a transaction, keeping every backup table at one revision boundary.
  const queries = [
    ["book", "SELECT * FROM kdp_books WHERE id=?"],
    [
      "chapters",
      "SELECT * FROM kdp_chapters WHERE book_id=? ORDER BY sort_order,id",
    ],
    [
      "sections",
      "SELECT s.* FROM kdp_sections s JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=? ORDER BY s.sort_order,s.id",
    ],
    [
      "sources",
      "SELECT x.* FROM kdp_sources x JOIN kdp_sections s ON s.id=x.section_id JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=?",
    ],
    [
      "proposals",
      "SELECT x.* FROM kdp_proposals x JOIN kdp_sections s ON s.id=x.section_id JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=?",
    ],
    [
      "history",
      "SELECT * FROM kdp_history WHERE (entity_type='books' AND entity_id=?) OR (entity_type='chapters' AND entity_id IN (SELECT id FROM kdp_chapters WHERE book_id=?)) OR (entity_type='sections' AND entity_id IN (SELECT s.id FROM kdp_sections s JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=?)) OR (entity_type='sources' AND entity_id IN (SELECT x.id FROM kdp_sources x JOIN kdp_sections s ON s.id=x.section_id JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=?)) OR (entity_type='proposals' AND entity_id IN (SELECT x.id FROM kdp_proposals x JOIN kdp_sections s ON s.id=x.section_id JOIN kdp_chapters c ON c.id=s.chapter_id WHERE c.book_id=?)) ORDER BY entity_type,entity_id,revision",
    ],
  ];
  const result = await env.DB.batch(
    queries.map(([name, sql]) =>
      env.DB.prepare(sql).bind(
        ...Array((sql.match(/\?/g) || []).length).fill(id),
      ),
    ),
  );
  const [books, chapters, sections, sources, proposals, history] = result.map(
    (r) => r.results,
  );
  if (!books.length) fail(404, "books not found");
  for (const ch of chapters) {
    ch.sections = sections.filter((s) => s.chapter_id === ch.id);
    for (const section of ch.sections) {
      section.sources = sources.filter((x) => x.section_id === section.id);
      section.proposals = proposals.filter((x) => x.section_id === section.id);
      section.history = history.filter(
        (x) => x.entity_type === "sections" && x.entity_id === section.id,
      );
    }
  }
  const backup = {
    book: books[0],
    chapters,
    history,
    format: "works-kdp-backup",
    version: 1,
    exported_at: new Date().toISOString(),
  };
  if (
    new TextEncoder().encode(JSON.stringify(backup)).byteLength >
    8 * 1024 * 1024
  )
    fail(413, "Book backup exceeds the 8 MB export limit");
  return backup;
}
export async function handleKdpRequest(request, env, url, headers = {}) {
  const send = (v, status = 200) =>
    new Response(JSON.stringify(v), {
      status,
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  try {
    await ensureKdpSchema(env.DB);
    const path = url.pathname
      .replace(/^\/api\/kdp\/?/, "")
      .split("/")
      .filter(Boolean);
    if (path.length > 3) fail(404, "KDP route not found");
    const [type, id, action] = path;
    const method = request.method;
    let data = {};
    if (["POST", "PATCH"].includes(method)) {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 512 * 1024) fail(413, "Request exceeds 512 KB");
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 512 * 1024)
        fail(413, "Request exceeds 512 KB");
      try {
        data = JSON.parse(raw);
      } catch {
        fail(400, "Invalid JSON");
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        fail(400, "JSON object required");
    }
    if (type === "books" && !id) {
      if (method === "GET") return send(await readBooks(env));
      if (method === "POST")
        return send(
          {
            book: await create(env.DB, "books", data),
          },
          201,
        );
    }
    if (
      ["books", "chapters"].includes(type) &&
      id &&
      action === "reorder" &&
      method === "POST"
    )
      return send(await reorderKdp(env, type, id, data));
    if (type === "books" && id && !action && method === "GET")
      return send(await readBook(env, id));
    if (type === "sections" && id && !action && method === "GET")
      return send(await getSection(env, id));
    if (fields[type] && id && !action && method === "PATCH")
      return send({
        [type.slice(0, -1)]: await update(env.DB, type, id, data),
      });
    if (type === "books" && id && action === "chapters" && method === "POST") {
      await row(env.DB, "books", id);
      return send(
        {
          chapter: await create(env.DB, "chapters", data, {
            key: "book_id",
            id,
          }),
        },
        201,
      );
    }
    if (
      type === "chapters" &&
      id &&
      action === "sections" &&
      method === "POST"
    ) {
      await row(env.DB, "chapters", id);
      return send(
        {
          section: await create(env.DB, "sections", data, {
            key: "chapter_id",
            id,
          }),
        },
        201,
      );
    }
    if (
      type === "sections" &&
      id &&
      ["sources", "proposals"].includes(action)
    ) {
      await row(env.DB, "sections", id);
      if (method === "GET")
        return send({
          [action]: await list(
            env.DB,
            `SELECT * FROM kdp_${action} WHERE section_id=? ORDER BY created_at DESC,id`,
            id,
          ),
        });
      if (method === "POST") {
        if (action === "proposals")
          return send(await createProposal(env, id, data), 201);
        return send(
          {
            source: await create(env.DB, "sources", data, {
              key: "section_id",
              id,
            }),
          },
          201,
        );
      }
    }
    if (type === "sections" && id && action === "history" && method === "GET") {
      await row(env.DB, "sections", id);
      return send(await readSectionHistory(env.DB, id, url.searchParams));
    }
    if (
      type === "sections" &&
      id &&
      action === "restore" &&
      method === "POST"
    ) {
      revision(data.target_revision);
      const h = await env.DB.prepare(
        "SELECT snapshot FROM kdp_history WHERE entity_type='sections' AND entity_id=? AND revision=?",
      )
        .bind(id, data.target_revision)
        .first();
      if (!h) fail(404, "Revision not found");
      const s = JSON.parse(h.snapshot);
      return send({
        section: await update(env.DB, "sections", id, {
          ...s,
          revision: data.revision,
        }),
      });
    }
    if (
      type === "proposals" &&
      id &&
      ["accept", "reject"].includes(action) &&
      method === "POST"
    )
      return send(await decide(env.DB, id, data, action === "accept"));
    return send(
      {
        error: "KDP route not found",
      },
      404,
    );
  } catch (e) {
    if (e.status)
      return send(
        {
          error: e.message,
        },
        e.status,
      );
    console.error("KDP request failed", e);
    return send(
      {
        error: "KDP operation failed",
      },
      500,
    );
  }
}
