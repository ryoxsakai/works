import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import worker from "../src/index.js";
const origin = "https://wiki.example.test";
export async function fixture({ legacy = false } = {}) {
  const mf = new Miniflare({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "wiki-auth", WIKI_DB: "wiki-data" },
  });
  const env = {
    DB: await mf.getD1Database("DB"),
    WIKI_DB: await mf.getD1Database("WIKI_DB"),
    SESSION_SECRET: "synthetic-only",
    WORKS_API_KEY: "synthetic-only-key",
    ALLOWED_EMAIL: "owner@example.test",
    ALLOWED_ORIGIN: origin,
  };
  for (const migration of legacy
    ? ["0001-wiki.sql"]
    : ["0001-wiki.sql", "0002-wiki-folders.sql"]) {
    const sql = await readFile(
      new URL("../wiki-migrations/" + migration, import.meta.url),
      "utf8",
    );
    await env.WIKI_DB.batch(
      sql
        .split(/(?=^(?:CREATE|ALTER|DROP) )/m)
        .filter((s) => s.trim())
        .map((s) => env.WIKI_DB.prepare(s)),
    );
  }

  const token = (payload) => {
    const b = Buffer.from(
      JSON.stringify({
        email: env.ALLOWED_EMAIL,
        exp: Date.now() + 3600000,
        ...payload,
      }),
    ).toString("base64url");
    return (
      b +
      "." +
      createHmac("sha256", env.SESSION_SECRET).update(b).digest("base64url")
    );
  };
  const browser = token({}),
    mcp = token({ aud: "works-mcp", scope: "schedule:read" });
  const api = (
    path,
    body,
    auth = browser,
    method = body ? "POST" : "GET",
    customEnv = env,
  ) =>
    worker.fetch(
      new Request(origin + "/api/wiki/" + path, {
        method,
        headers: {
          Authorization: "Bearer " + auth,
          "Content-Type": "application/json",
          Origin: origin,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      customEnv,
    );
  const call = (name, args, auth = mcp) =>
    worker.fetch(
      new Request(origin + "/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + auth,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
      env,
    );
  return { mf, env, browser, mcp, api, call };
}
