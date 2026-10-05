import {
  readBooks,
  readBook,
  getSection,
  createProposal,
  exportBook,
  exportCurrentBook,
  ensureKdpSchema,
  handleKdpRequest,
} from "./kdp.js";
import { handleAssets, readAssets, boundedBytes } from "./kdp-assets.js";
import { buildEpub, exportMarkdown, zipStore } from "./kdp-export.js";
const obj = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = { type: "string" };
export const kdpTools = [
  {
    name: "list_kdp_books",
    description: "KDP管理の本を一覧取得。アーカイブを含みます。",
    inputSchema: obj({}),
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_kdp_book",
    description: "KDP管理の本のメタ情報・章節・採用本文とrevisionを取得。",
    inputSchema: obj({ book_id: str }, ["book_id"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_kdp_section",
    description: "節の採用本文とrevisionを確認。改稿前に必ず取得してください。",
    inputSchema: obj({ section_id: str }, ["section_id"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "create_kdp_proposal",
    description:
      "元revisionが一致する節に改稿案を保存。採用本文は変更しません。採用・却下は本人がKDP管理画面で行います。",
    inputSchema: obj(
      {
        section_id: str,
        base_revision: { type: "integer", minimum: 1 },
        body: str,
        title: str,
        notes: str,
      },
      ["section_id", "base_revision", "body"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
export async function callKdpTool(env, name, args) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw Object.assign(new Error("arguments must be an object"), {
      status: 400,
    });
  if (name === "list_kdp_books") return readBooks(env);
  if (name === "get_kdp_book") return readBook(env, args.book_id);
  if (name === "get_kdp_section") return getSection(env, args.section_id);
  if (name === "create_kdp_proposal")
    return createProposal(env, args.section_id, args);
  throw Object.assign(new Error("Unknown KDP tool"), { status: 404 });
}
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
export async function handleKdp(request, env, url, headers) {
  const noCache = {
    ...headers,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  await ensureKdpSchema(env.DB);
  if (/\/images(?:\/|$)/.test(url.pathname))
    return handleAssets(request, env, url, noCache);
  const match = url.pathname.match(/^\/api\/kdp\/books\/([\w-]+)\/export$/);
  if (match && request.method === "GET") {
    const format = url.searchParams.get("format") || "json";
    if (!["epub", "json", "markdown"].includes(format))
      throw Object.assign(new Error("format must be epub, json or markdown"), {
        status: 400,
      });
    const tree = await (format === "epub" ? exportCurrentBook : exportBook)(
      env,
      match[1],
    );
    const assets = await readAssets(env, match[1]);
    let bytes, type, extension;
    if (format === "epub") {
      bytes = buildEpub(tree, assets);
      type = "application/epub+zip";
      extension = "epub";
    } else if (format === "json") {
      // Write each embedded image independently: never retain a base64 string for
      // the whole 20 MiB image collection alongside the finished response.
      const encoder = new TextEncoder();
      let position = -1;
      bytes = new ReadableStream({
        pull(controller) {
          if (position === -1) {
            controller.enqueue(
              encoder.encode(JSON.stringify(tree).slice(0, -1) + ',"assets":['),
            );
            position = 0;
            return;
          }
          if (position < assets.length) {
            const { bytes: imageBytes, ...metadata } = assets[position];
            controller.enqueue(
              encoder.encode(
                (position ? "," : "") +
                  JSON.stringify({
                    ...metadata,
                    data_base64: base64(imageBytes),
                  }),
              ),
            );
            position++;
            return;
          }
          controller.enqueue(encoder.encode("]}"));
          controller.close();
        },
      });
      type = "application/json; charset=utf-8";
      extension = "json";
    } else {
      // The ZIP already holds the original assets. Metadata points at these
      // files; duplicating them as base64 would triple peak Worker memory.
      const backup = JSON.stringify(
        {
          ...tree,
          assets: assets.map(({ bytes, ...a }) => ({
            ...a,
            asset_file: `images/${a.id}.${a.extension}`,
          })),
        },
        null,
        2,
      );
      let md = exportMarkdown(tree);
      for (const a of assets)
        md = md.replaceAll(
          "kdp-image:" + a.id,
          `images/${a.id}.${a.extension}`,
        );
      bytes = zipStore([
        { name: "manuscript.md", data: md },
        { name: "backup.json", data: backup },
        ...assets.map((a) => ({
          name: `images/${a.id}.${a.extension}`,
          data: a.bytes,
        })),
      ]);
      type = "application/zip";
      extension = "zip";
    }
    return new Response(bytes, {
      headers: {
        ...noCache,
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="kdp-${match[1]}.${extension}"`,
      },
    });
  }
  if (["POST", "PATCH"].includes(request.method)) {
    const bytes = await boundedBytes(request, 512 * 1024);
    request = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bytes,
    });
  }
  return handleKdpRequest(request, env, url, noCache);
}
