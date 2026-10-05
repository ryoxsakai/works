// Assets use the existing private R2 binding. No public image URLs or remote fetches.
export const ASSET_SCHEMA =
  "CREATE TABLE IF NOT EXISTS kdp_assets (id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES kdp_books(id), content_type TEXT NOT NULL, extension TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))";
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
export const ASSET_QUOTA =
  "CREATE TRIGGER IF NOT EXISTS kdp_assets_quota BEFORE INSERT ON kdp_assets BEGIN SELECT CASE WHEN (SELECT COALESCE(SUM(size),0) FROM kdp_assets WHERE book_id=NEW.book_id)+NEW.size>20971520 OR (SELECT COUNT(*) FROM kdp_assets WHERE book_id=NEW.book_id)>=40 THEN RAISE(ABORT,'KDP image quota exceeded') END; END";
export async function ensureAssets(env) {
  await env.DB.batch([
    env.DB.prepare(ASSET_SCHEMA),
    env.DB.prepare(ASSET_QUOTA),
  ]);
}
export async function handleAssets(request, env, url, headers = {}) {
  await ensureAssets(env);
  const upload = url.pathname.match(/^\/api\/kdp\/books\/([\w-]+)\/images$/);
  if (upload && request.method === "POST") {
    const book = await env.DB.prepare("SELECT * FROM kdp_books WHERE id=?")
      .bind(upload[1])
      .first();
    if (!book) fail(404, "Book not found");
    if (book.archived) fail(409, "Book is archived");
    if (!env.MATERIALS_BUCKET) fail(503, "Image storage is unavailable");
    const bytes = new Uint8Array(await boundedBytes(request, 5 * 1024 * 1024));
    const type = request.headers.get("Content-Type")?.split(";")[0];
    let extension;
    if (
      type === "image/png" &&
      bytes[0] === 137 &&
      bytes[1] === 80 &&
      bytes[2] === 78 &&
      bytes[3] === 71 &&
      bytes[4] === 13 &&
      bytes[5] === 10 &&
      bytes[6] === 26 &&
      bytes[7] === 10
    )
      extension = "png";
    else if (
      type === "image/jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    )
      extension = "jpg";
    else fail(400, "PNG/JPEG画像を選択してください。");
    const totals = await env.DB.prepare(
      "SELECT COALESCE(SUM(size),0) AS bytes, COUNT(*) AS count FROM kdp_assets WHERE book_id=?",
    )
      .bind(book.id)
      .first();
    if (totals.bytes + bytes.length > 20 * 1024 * 1024 || totals.count >= 40)
      fail(413, "本ごとの画像上限は20MB・40枚です。");
    const id = crypto.randomUUID(),
      key = `kdp/${book.id}/${id}`;
    await env.MATERIALS_BUCKET.put(key, bytes, {
      httpMetadata: { contentType: type },
    });
    try {
      await env.DB.prepare(
        "INSERT INTO kdp_assets(id,book_id,content_type,extension,size) VALUES (?,?,?,?,?)",
      )
        .bind(id, book.id, type, extension, bytes.length)
        .run();
    } catch (error) {
      await env.MATERIALS_BUCKET.delete(key);
      throw error;
    }
    return new Response(
      JSON.stringify({
        image: {
          id,
          book_id: book.id,
          content_type: type,
          extension,
          size: bytes.length,
          markdown: `![画像](kdp-image:${id})`,
        },
      }),
      {
        status: 201,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  const get = url.pathname.match(/^\/api\/kdp\/images\/([\w-]+)$/);
  if (get && request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM kdp_assets WHERE id=?")
      .bind(get[1])
      .first();
    if (!row) fail(404, "Image not found");
    const obj = await env.MATERIALS_BUCKET.get(`kdp/${row.book_id}/${row.id}`);
    if (!obj) fail(404, "Image not found");
    return new Response(obj.body, {
      headers: {
        ...headers,
        "Content-Type": row.content_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  fail(404, "Image endpoint not found");
}
export async function boundedBytes(request, max) {
  if (Number(request.headers.get("Content-Length")) > max)
    fail(413, "データが大きすぎます。");
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      fail(413, "データが大きすぎます。");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes.buffer;
}
export async function readAssets(env, bookId) {
  await ensureAssets(env);
  const rows = (
    await env.DB.prepare("SELECT * FROM kdp_assets WHERE book_id=? ORDER BY id")
      .bind(bookId)
      .all()
  ).results;
  const out = [];
  let total = 0;
  for (const a of rows) {
    total += a.size;
    if (total > 20 * 1024 * 1024) fail(413, "画像上限を超えています。");
    const obj = await env.MATERIALS_BUCKET.get(`kdp/${bookId}/${a.id}`);
    if (!obj) fail(422, "画像が見つかりません。");
    out.push({ ...a, bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  return out;
}
