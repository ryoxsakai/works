import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { KDP_SCHEMA } from "../src/kdp.js";
test("KDP migration and runtime schema match", () => {
  assert.equal(
    readFileSync(new URL("../migrations/001-kdp.sql", import.meta.url), "utf8"),
    KDP_SCHEMA.join("\n") + "\n",
  );
});
test("SQLite revisions, atomic acceptance, immutable history and restoration", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import sqlite3,json
c=sqlite3.connect(':memory:')
c.executescript(${JSON.stringify(KDP_SCHEMA.join("\n"))})
c.execute("INSERT INTO kdp_books(id,title) VALUES ('b','日本 / English')")
c.execute("INSERT INTO kdp_chapters(id,book_id) VALUES ('c','b')")
c.execute("INSERT INTO kdp_sections(id,chapter_id,body) VALUES ('s','c','original')")
c.execute("INSERT INTO kdp_proposals(id,section_id,body,base_revision,base_body) VALUES ('p','s','accepted',1,'original')")
assert c.execute("UPDATE kdp_sections SET body='mine',revision=revision+1 WHERE id='s' AND revision=1 RETURNING revision").fetchone()[0]==2
assert c.execute("UPDATE kdp_sections SET body='lost',revision=revision+1 WHERE id='s' AND revision=1 RETURNING revision").fetchone() is None
assert c.execute("UPDATE kdp_sections SET body='accepted',revision=revision+1 WHERE id='s' AND revision=1 AND EXISTS(SELECT 1 FROM kdp_proposals WHERE id='p' AND status='pending') RETURNING revision").fetchone() is None
assert c.execute("UPDATE kdp_proposals SET status='accepted',revision=revision+1 WHERE id='p' AND changes()=1 RETURNING revision").fetchone() is None
assert c.execute("SELECT status FROM kdp_proposals WHERE id='p'").fetchone()[0]=='pending'
snapshot=json.loads(c.execute("SELECT snapshot FROM kdp_history WHERE entity_id='s' AND revision=1").fetchone()[0])
c.execute("UPDATE kdp_sections SET body=?,revision=revision+1 WHERE id='s' AND revision=2",(snapshot['body'],))
assert c.execute("SELECT revision,body FROM kdp_sections WHERE id='s'").fetchone()==(3,'original')
c.execute("UPDATE kdp_sections SET archived=1,revision=revision+1 WHERE id='s' AND revision=3")
c.execute("UPDATE kdp_sections SET archived=0,revision=revision+1 WHERE id='s' AND revision=4")
assert c.execute("SELECT count(*) FROM kdp_history WHERE entity_id='s'").fetchone()[0]==5
for sql in ["UPDATE kdp_history SET snapshot='{}'", "DELETE FROM kdp_history"]:
 try: c.execute(sql); raise AssertionError('History mutation allowed')
 except sqlite3.IntegrityError: pass
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("atomic sibling reorder checks every revision and freezes eligibility", async () => {
  const { reorderKdp } = await import("../src/kdp.js");
  let captured;
  const db = {
    batch: async () => [],
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => ({ id: "b", archived: 0 }),
            all: async () => {
              captured = { sql, args };
              return {
                results: [
                  { id: "c2", sort_order: 0, revision: 2 },
                  { id: "c1", sort_order: 1024, revision: 2 },
                ],
              };
            },
          };
        },
      };
    },
  };
  const response = await reorderKdp({ DB: db }, "books", "b", {
    chapters: [
      { id: "c2", revision: 1 },
      { id: "c1", revision: 1 },
    ],
  });
  assert.deepEqual(
    response.chapters.map((x) => x.id),
    ["c2", "c1"],
  );
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import sqlite3,json
c=sqlite3.connect(':memory:')
c.executescript(${JSON.stringify(KDP_SCHEMA.join("\n"))})
c.execute("INSERT INTO kdp_books(id) VALUES ('b')")
c.execute("INSERT INTO kdp_chapters(id,book_id,sort_order) VALUES ('c1','b',0),('c2','b',1024)")
sql=${JSON.stringify(captured.sql)}
args=json.loads(${JSON.stringify(JSON.stringify(captured.args))})
rows=c.execute(sql,args).fetchall()
assert len(rows)==2
assert c.execute("SELECT id,sort_order,revision FROM kdp_chapters ORDER BY sort_order").fetchall()==[('c2',0,2),('c1',1024,2)]
assert c.execute("SELECT count(*) FROM kdp_history WHERE entity_type='chapters'").fetchone()[0]==4
# Stale revisions must leave every sibling untouched.
assert c.execute(sql,args).fetchall()==[]
assert c.execute("SELECT sum(revision) FROM kdp_chapters").fetchone()[0]==4
args[0]=json.dumps([{'id':'c1','revision':2}])
assert c.execute(sql,args).fetchall()==[]
args[0]=json.dumps([{'id':'c1','revision':2},{'id':'c2','revision':1}])
assert c.execute(sql,args).fetchall()==[]
args[0]=json.dumps([{'id':'c1','revision':2},{'id':'c2','revision':2}])
c.execute("UPDATE kdp_books SET archived=1,revision=revision+1 WHERE id='b'")
assert c.execute(sql,args).fetchall()==[]
assert c.execute("SELECT sum(revision) FROM kdp_chapters").fetchone()[0]==4
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
});

test("export preflight counts UTF-8 history bytes before materializing large books", async () => {
  const { KDP_EXPORT_PREFLIGHT_SQL, exportBook } = await import(
    "../src/kdp.js"
  );
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import sqlite3
c=sqlite3.connect(':memory:')
c.executescript(${JSON.stringify(KDP_SCHEMA.join("\n"))})
c.execute("INSERT INTO kdp_books(id) VALUES ('b')")
c.execute("INSERT INTO kdp_chapters(id,book_id) VALUES ('c','b')")
c.execute("INSERT INTO kdp_sections(id,chapter_id,body) VALUES ('s','c',?)",('日本語'*60000,))
sql=${JSON.stringify(KDP_EXPORT_PREFLIGHT_SQL)}
small=c.execute(sql,('b','b')).fetchone()[0]
assert small>len(('日本語'*60000).encode('utf-8'))*4
for revision in range(1,5): c.execute("UPDATE kdp_sections SET revision=revision+1 WHERE id='s' AND revision=?",(revision,))
assert c.execute(sql,('b','b')).fetchone()[0]>8*1024*1024
assert c.execute(sql,('other','other')).fetchone()[0]==0
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  let batches = 0;
  const db = {
    batch: async () => {
      batches++;
      return [];
    },
    prepare: (sql) => ({
      bind: () => ({
        first: async () => ({ estimated_bytes: 9 * 1024 * 1024 }),
      }),
    }),
  };
  await assert.rejects(
    exportBook({ DB: db }, "b"),
    (error) => error.status === 413,
  );
  assert.equal(
    batches,
    1,
    "only schema batch executes; large manuscript batch must not execute",
  );
});

test("current EPUB manuscript export ignores large immutable histories", async () => {
  const {
    KDP_CURRENT_EXPORT_SIZE_SQL,
    KDP_EXPORT_PREFLIGHT_SQL,
    exportCurrentBook,
  } = await import("../src/kdp.js");
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import sqlite3
c=sqlite3.connect(':memory:')
c.executescript(${JSON.stringify(KDP_SCHEMA.join("\n"))})
c.execute("INSERT INTO kdp_books(id) VALUES ('b')")
c.execute("INSERT INTO kdp_chapters(id,book_id) VALUES ('c','b')")
c.execute("INSERT INTO kdp_sections(id,chapter_id,body) VALUES ('s','c',?)",('日本語'*60000,))
for revision in range(1,5): c.execute("UPDATE kdp_sections SET revision=revision+1 WHERE id='s' AND revision=?",(revision,))
assert c.execute(${JSON.stringify(KDP_EXPORT_PREFLIGHT_SQL)},('b','b')).fetchone()[0]>8*1024*1024
assert c.execute(${JSON.stringify(KDP_CURRENT_EXPORT_SIZE_SQL)},('b','b','b')).fetchone()[0]<8*1024*1024
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  let batches = 0;
  const db = {
    batch: async (statements) => {
      batches++;
      return batches === 1
        ? []
        : [
            { results: [{ id: "b" }] },
            { results: [{ id: "c", book_id: "b" }] },
            { results: [{ id: "s", chapter_id: "c", body: "current text" }] },
          ];
    },
    prepare: (sql) => {
      assert.ok(
        !sql.includes("FROM kdp_history"),
        "current export never queries histories",
      );
      return {
        bind: () => ({ first: async () => ({ estimated_bytes: 2048 }) }),
      };
    },
  };
  const manuscript = await exportCurrentBook({ DB: db }, "b");
  assert.equal(manuscript.chapters[0].sections[0].body, "current text");
  assert.equal(batches, 2);
});

test("section history uses bounded keyset pages and validates query parameters", async () => {
  const { readSectionHistory } = await import("../src/kdp.js");
  let captured;
  const revisions = Array.from({ length: 25 }, (_, i) => ({
    revision: 25 - i,
    snapshot: "{}",
  }));
  const db = {
    prepare: (sql) => ({
      bind: (...args) => ({
        all: async () => {
          captured = { sql, args };
          const before = args.length === 3 ? args[1] : Infinity;
          return {
            results: revisions
              .filter((row) => row.revision < before)
              .slice(0, args.at(-1)),
          };
        },
      }),
    }),
  };
  const first = await readSectionHistory(db, "s");
  assert.equal(first.history.length, 10);
  assert.equal(first.next_before_revision, 16);
  assert.deepEqual(captured.args, ["s", 11]);
  const next = await readSectionHistory(
    db,
    "s",
    new URLSearchParams("before_revision=16&limit=20"),
  );
  assert.equal(next.history.length, 15);
  assert.equal(next.history[0].revision, 15);
  assert.equal(next.next_before_revision, null);
  assert.match(captured.sql, /revision<\?/);
  assert.deepEqual(captured.args, ["s", 16, 21]);
  for (const query of [
    "limit=0",
    "limit=21",
    "limit=x",
    "limit=1.5",
    "before_revision=0",
    "before_revision=-1",
    "before_revision=",
    "before_revision=9007199254740992",
  ]) {
    await assert.rejects(
      readSectionHistory(db, "s", new URLSearchParams(query)),
      (error) => error.status === 400,
    );
  }
});
