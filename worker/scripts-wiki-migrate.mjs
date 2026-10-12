// Deliberate separate migration entrypoint. Requires a verified UUID, never a name.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const [mode, id] = process.argv.slice(2);
if (
  !["--local", "--remote"].includes(mode) ||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || "")
)
  throw new Error(
    "Usage: npm run wiki:migrate -- --local|--remote VERIFIED_WIKI_DATABASE_UUID",
  );
const config = readFileSync(
  new URL("./wrangler.toml", import.meta.url),
  "utf8",
);
const active = config
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");
const blocks = active
  .split("[[d1_databases]]")
  .slice(1)
  .map((b) => b.split(/\n\[/)[0]);
const wiki = blocks.find((b) => /^binding\s*=\s*"WIKI_DB"/m.test(b));
const bindingId = wiki?.match(/^database_id\s*=\s*"([^"]+)"/m)?.[1];
if (wiki?.match(/^migrations_dir\s*=\s*"([^"]+)"/m)?.[1] !== "wiki-migrations")
  throw new Error("WIKI_DB must use the dedicated wiki-migrations directory");
if (bindingId !== id)
  throw new Error(
    "UUID must match WIKI_DB binding in wrangler.toml; no existing DB fallback",
  );
if (blocks.some((b) => !/^binding\s*=\s*"WIKI_DB"/m.test(b) && b.includes(id)))
  throw new Error(
    "Wiki UUID is also bound to an existing database; refusing migration",
  );
const r = spawnSync(
  process.execPath,
  [
    "node_modules/wrangler/bin/wrangler.js",
    "d1",
    "migrations",
    "apply",
    id,
    mode,
  ],
  {
    stdio: "inherit",
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  },
);
process.exit(r.status ?? 1);
