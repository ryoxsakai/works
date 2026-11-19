import {
  readBooks,
  readBook,
  getSection,
  createProposal,
  createKdpEntity,
  decideKdpProposal,
  exportBook,
  exportCurrentBook,
  ensureKdpSchema,
  handleKdpRequest,
} from "./kdp.js";
import { handleAssets, readAssets, boundedBytes } from "./kdp-assets.js";
import { buildEpub, exportMarkdown, zipStore } from "./kdp-export.js";
import { kdpMcpWriteEnabled, requireKdpWrite } from "./mcp-scopes.js";
import { prepareKdpMutation, replayKdpMutation } from "./kdp-mutations.js";
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
      "元revisionが一致する節に改稿案を保存。採用本文は変更しません。採用はKDP管理画面、または別途kdp:writeの明示同意がある接続から行います。",
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
const rev = { type: "integer", minimum: 1 };
const title = { type: "string", minLength: 1, maxLength: 300 };
const requestId = { type: "string", minLength: 8, maxLength: 128, pattern: "^[A-Za-z0-9_-]+$" };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const retryNote = " kdp:writeの明示同意が必要。同じ送信の再試行ではrequest_idと全引数を維持してください。";
export const kdpWriteTools = [
  {
    name: "create_kdp_book",
    description: "KDP管理に新しい本を作成。" + retryNote,
    inputSchema: obj({ request_id: requestId, title, subtitle: { ...str, maxLength: 300 }, author: { ...str, maxLength: 300 }, language: { ...str, maxLength: 20000 }, audience: { ...str, maxLength: 20000 }, description: { ...str, maxLength: 20000 } }, ["request_id", "title"]),
    annotations: writeAnnotations,
  },
  {
    name: "create_kdp_chapter",
    description: "get_kdp_bookで本とrevisionを確認して章を作成。" + retryNote,
    inputSchema: obj({ request_id: requestId, book_id: str, book_revision: rev, title, sort_order: { type: "integer" } }, ["request_id", "book_id", "book_revision", "title"]),
    annotations: writeAnnotations,
  },
  {
    name: "create_kdp_section",
    description: "get_kdp_bookで章とrevisionを確認して節を作成。bodyを指定すると初期採用本文として保存。" + retryNote,
    inputSchema: obj({ request_id: requestId, chapter_id: str, chapter_revision: rev, title, body: { ...str, maxLength: 200000 }, sort_order: { type: "integer" } }, ["request_id", "chapter_id", "chapter_revision", "title"]),
    annotations: writeAnnotations,
  },
  {
    name: "accept_kdp_proposal",
    description: "get_kdp_sectionで本文と提案を読み、ユーザーが指定した改稿案を採用。節の現在revision・提案base_revisionが一致する場合だけ採用本文を変更。revisionは提案のrevision。" + retryNote,
    inputSchema: obj({ request_id: requestId, proposal_id: str, revision: rev, base_revision: rev }, ["request_id", "proposal_id", "revision", "base_revision"]),
    annotations: { ...writeAnnotations, destructiveHint: true },
  },
  {
    name: "reject_kdp_proposal",
    description: "get_kdp_sectionで確認した改稿案を却下。採用本文は変更しません。revisionは提案のrevision。" + retryNote,
    inputSchema: obj({ request_id: requestId, proposal_id: str, revision: rev }, ["request_id", "proposal_id", "revision"]),
    annotations: writeAnnotations,
  },
];
export const availableKdpTools = env => [...kdpTools, ...(kdpMcpWriteEnabled(env) ? kdpWriteTools : [])];

function validateWriteArguments(tool, args) {
  if (new TextEncoder().encode(JSON.stringify(args)).byteLength > 512 * 1024)
    throw Object.assign(new Error("KDP write exceeds 512 KB"), { status: 413 });
  const { properties, required } = tool.inputSchema;
  if (Object.keys(args).some(key => !Object.hasOwn(properties, key)))
    throw Object.assign(new Error("Unknown KDP write argument"), { status: 400 });
  for (const key of required)
    if (!Object.hasOwn(args, key)) throw Object.assign(new Error(`${key} is required`), { status: 400 });
  for (const [key, value] of Object.entries(args)) {
    const rule = properties[key];
    if (rule.type === "string" ? typeof value !== "string" || value.length < (rule.minLength ?? 0) || ((key === "title" || key.endsWith("_id")) && !value.trim()) || value.length > (rule.maxLength ?? Infinity) : !Number.isSafeInteger(value) || value < (rule.minimum ?? -Infinity))
      throw Object.assign(new Error(`Invalid ${key}`), { status: 400 });
  }
}
export async function callKdpTool(env, name, args, auth) {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw Object.assign(new Error("arguments must be an object"), {
      status: 400,
    });
  if (name === "list_kdp_books") return readBooks(env);
  if (name === "get_kdp_book") return readBook(env, args.book_id);
  if (name === "get_kdp_section") return getSection(env, args.section_id);
  if (name === "create_kdp_proposal")
    return createProposal(env, args.section_id, args);
  const tool = kdpWriteTools.find(tool => tool.name === name);
  if (tool) {
    requireKdpWrite(env, auth);
    validateWriteArguments(tool, args);
    const receipt = await prepareKdpMutation(env.DB, auth.fid, name, args);
    const replay = await replayKdpMutation(env.DB, receipt);
    if (replay) return replay;
    try {
      if (name === "create_kdp_book") return await createKdpEntity(env, "books", args, undefined, receipt);
      if (name === "create_kdp_chapter") return await createKdpEntity(env, "chapters", args, { key: "book_id", id: args.book_id }, receipt, args.book_revision);
      if (name === "create_kdp_section") return await createKdpEntity(env, "sections", args, { key: "chapter_id", id: args.chapter_id }, receipt, args.chapter_revision);
      return await decideKdpProposal(env, args.proposal_id, args, name === "accept_kdp_proposal", receipt);
    } catch (error) {
      // A parallel retry can win after the initial receipt read but before preflight.
      const saved = await replayKdpMutation(env.DB, receipt);
      if (saved) return saved;
      throw error;
    }
  }
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
