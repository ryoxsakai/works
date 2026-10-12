import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
const origin = "https://works-wiki.test",
  root = new URL("../../", import.meta.url);
const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("fixture")}}',
  compatibilityDate: "2026-08-01",
  d1Databases: { DB: "wiki-browser-auth", WIKI_DB: "wiki-browser" },
});
let browser;
try {
  const env = {
    DB: await mf.getD1Database("DB"),
    WIKI_DB: await mf.getD1Database("WIKI_DB"),
    SESSION_SECRET: "synthetic-only",
    ALLOWED_EMAIL: "fixture@example.test",
    ALLOWED_ORIGIN: origin,
  };
  const sql = await readFile(
    new URL("../wiki-migrations/0001-wiki.sql", import.meta.url),
    "utf8",
  );
  await env.WIKI_DB.batch(
    sql
      .split(/(?=^CREATE )/m)
      .filter((s) => s.trim())
      .map((s) => env.WIKI_DB.prepare(s)),
  );
  const payload = Buffer.from(
    JSON.stringify({ email: env.ALLOWED_EMAIL, exp: Date.now() + 3600000 }),
  ).toString("base64url");
  const token =
    payload +
    "." +
    createHmac("sha256", env.SESSION_SECRET)
      .update(payload)
      .digest("base64url");
  async function api(path, body) {
    const r = await worker.fetch(
      new Request(origin + "/api/wiki/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env,
    );
    assert.ok(r.ok, await r.clone().text());
    return r.json();
  }
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE || "/usr/bin/chromium",
  });
  await mkdir("test-artifacts", { recursive: true });
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
        viewport,
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      try {
        if (u.origin !== origin) return route.fulfill({ body: "" });
        if (u.pathname === "/shared/auth.js")
          return route.fulfill({
            contentType: "text/javascript",
            body: `export const getSessionToken=()=>${JSON.stringify(token)};export function watchAuth(o){queueMicrotask(()=>o.onSignedIn())}export function signIn(){}export async function signOutUser(){}`,
          });
        if (u.pathname.startsWith("/api/")) {
          const r = await worker.fetch(
            new Request(req.url(), {
              method: req.method(),
              headers: req.headers(),
              ...(req.postDataBuffer() ? { body: req.postDataBuffer() } : {}),
            }),
            env,
          );
          return route.fulfill({
            status: r.status,
            headers: Object.fromEntries(r.headers),
            body: Buffer.from(await r.arrayBuffer()),
          });
        }
        const p = u.pathname.endsWith("/")
          ? u.pathname + "index.html"
          : u.pathname;
        return route.fulfill({
          body: await readFile(new URL("." + p, root)),
          contentType: p.endsWith(".js")
            ? "text/javascript"
            : p.endsWith(".css")
              ? "text/css"
              : "text/html",
        });
      } catch (e) {
        errors.push(e.message);
        return route.fulfill({ status: 500, body: e.message });
      }
    });
    await page.goto(origin + "/wiki/");
    await expect(page.locator("#new")).toBeEnabled();
    await page.locator("#new").click();
    await page.locator("[name=title]").fill(name + " knowledge");
    await page.locator("[name=body]").fill("# Heading\n\nSafe **knowledge**");
    await page.locator("[name=tags]").fill("science");
    await page.locator("[name=aliases]").fill("synthetic alias " + name);
    await page.locator("#add-source").click();
    await page.locator("[name=source-type]").selectOption("web");
    await page.locator("[name=source-url]").fill("https://example.test/source");
    await page.locator("[name=source-location]").fill("§2");
    await page.locator("[name=source-checked_at]").fill("2026-10-12");
    await page
      .getByRole("button", { name: "本文として保存", exact: true })
      .click();
    await expect(page.locator("#title")).toHaveText(name + " knowledge");
    await expect(page.locator("#body h1")).toHaveText("Heading");
    await page.locator("#edit").click();
    await page.locator("[name=body]").fill("proposed knowledge");
    await page.locator("#proposal-notes").fill("synthetic proposal");
    await page.locator("#propose").click();
    await expect(page.locator("#proposals")).toContainText(
      "synthetic proposal",
    );
    await expect(page.locator("#body")).toContainText("Safe knowledge");
    await page.locator("[data-compare-proposal]").click();
    await expect(page.locator("#comparison")).toContainText(
      "proposed knowledge",
    );
    page.on("dialog", (d) => d.accept());
    await page.locator("[data-accept]").click();
    await expect(page.locator("#body")).toContainText("proposed knowledge");
    await expect(page.locator("#meta")).toContainText("revision 2");
    // An external write during editing must conflict and preserve the old input.
    const id = await page
      .locator("#pages button")
      .filter({ hasText: name + " knowledge" })
      .getAttribute("data-page");
    await page.locator("#edit").click();
    await page.locator("[name=body]").fill("my unsaved work");
    const latest = (await api("pages/" + id)).page;
    await api("pages/" + id + "/save", {
      revision: latest.revision,
      content: { ...latest, body: "external change" },
    });
    await page
      .getByRole("button", { name: "本文として保存", exact: true })
      .click();
    await expect(page.locator("#message")).toContainText("入力は保持");
    await expect(page.locator("[name=body]")).toHaveValue("my unsaved work");
    await page.locator("#cancel").click();
    await page.locator('[data-page="' + id + '"]').click();
    await expect(page.locator("#body")).toContainText("external change");
    // Discarding editor for restore must close it, preventing an old-form save.
    await page.locator("#edit").click();
    await page.locator("[name=body]").fill("old form");
    await page.locator('[data-restore="1"]').click();
    await expect(page.locator("#editor")).toBeHidden();
    await expect(page.locator("#body")).toContainText("Safe knowledge");
    const download = page.waitForEvent("download");
    await page.locator("[data-export=json]").click();
    assert.match((await download).suggestedFilename(), /\.json$/);
    await page.locator("#archive").click();
    await expect(page.locator("#meta")).toContainText("アーカイブ");
    await page.locator("#archives").check();
    await page.locator("#search").fill("synthetic alias " + name);
    await page.locator("#find").click();
    await expect(page.locator("#pages")).toContainText(name + " knowledge");
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await expect(page.locator("#find")).toBeEnabled();
    await page.screenshot({
      path: "test-artifacts/wiki-" + name + ".png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "Wiki desktop/mobile creation, citations, proposals, comparison, conflict retention, restoration, archive, search, export passed",
  );
} finally {
  await browser?.close();
  await mf.dispose();
}
