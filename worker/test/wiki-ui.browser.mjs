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
async function checkTheme(page, theme) {
  // OS changes arrive through matchMedia events; wait for the shared controller.
  await page.waitForFunction((expected) => getComputedStyle(document.documentElement).colorScheme === expected, theme);
  let results;
  const measure = () =>
    page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d");
      const rgb = (c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((v) => v / 255);
      };
      const lum = (c) =>
        c
          .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      const base = getComputedStyle(document.documentElement).getPropertyValue(
        "--bg-elevated",
      );
      const checks = [
        ...document.querySelectorAll(
          ".source,.proposal,#history > div,#pages small,#detail p,#detail h1,#detail h2,#detail h3,#detail h4,#detail a,#detail button,#detail pre,#editor input,#editor select,#editor textarea,#editor label,#editor button,#message,#search",
        ),
      ]
        .filter((e) => e.getClientRects().length && !e.disabled)
        .map((e) => {
          let a = e,
            bg = base;
          while (a) {
            const c = getComputedStyle(a).backgroundColor;
            if (c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
              bg = c;
              break;
            }
            a = a.parentElement;
          }
          const f = lum(rgb(getComputedStyle(e).color)),
            b = lum(rgb(bg));
          return {
            element: e.id || e.tagName + ":" + e.getAttribute("name"),
            foreground: getComputedStyle(e).color,
            background: bg,
            contrast: (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
          };
        });
      const search = document.querySelector("#search");
      const placeholder = getComputedStyle(search, "::placeholder");
      const p = lum(rgb(placeholder.color)),
        b = lum(rgb(getComputedStyle(search).backgroundColor));
      checks.push({
        element: "search placeholder",
        foreground: placeholder.color,
        background: getComputedStyle(search).backgroundColor,
        contrast: (Math.max(p, b) + 0.05) / (Math.min(p, b) + 0.05),
      });
      const focus = document.activeElement;
      if (focus?.matches("textarea,input:not([type=checkbox])")) {
        const style = getComputedStyle(focus);
        if (style.outlineStyle === "solid") {
          const f = lum(rgb(style.outlineColor)),
            bg = lum(
              rgb(
                getComputedStyle(focus.parentElement).backgroundColor ===
                  "rgba(0, 0, 0, 0)"
                  ? base
                  : getComputedStyle(focus.parentElement).backgroundColor,
              ),
            );
          checks.push({
            element: "focus outline",
            contrast: (Math.max(f, bg) + 0.05) / (Math.min(f, bg) + 0.05),
          });
        }
      }
      return checks;
    });
  await expect
    .poll(async () => {
      results = await measure();
      return results
        .filter((r) => r.contrast < 4.5)
        .map((r) => r.element + ":" + r.contrast)
        .join(", ");
    })
    .toBe("");
  assert.ok(results.length > 10);
  for (const r of results)
    assert.ok(
      r.contrast >= 4.5,
      `${theme} ${r.element} contrast ${r.contrast} ${r.foreground} / ${r.background}`,
    );
  assert.equal(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
    theme,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}
async function setTheme(page, value) {
  await page.evaluate(async (theme) => {
    const { setTheme } = await import("/shared/theme.js?v=5");
    setTheme(theme);
  }, value);
}
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
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  await mkdir("test-artifacts", { recursive: true });
  for (const [name, viewport] of [
    ["desktop-light", { width: 1440, height: 1000 }],
    ["desktop-dark", { width: 1440, height: 1000 }],
    ["mobile-light", { width: 390, height: 844 }],
    ["mobile-dark", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
        viewport,
        colorScheme: name.endsWith("dark") ? "light" : "dark",
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    const selectedTheme = name.endsWith("dark") ? "dark" : "light";
    await context.addInitScript((theme) => {
      if (!sessionStorage.themeSeeded) {
        localStorage.setItem("works_theme", theme);
        sessionStorage.themeSeeded = "1";
      }
    }, selectedTheme);
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
    const themePageId = await page
      .locator("#pages button")
      .filter({ hasText: name + " knowledge" })
      .getAttribute("data-page");
    await page.locator("#edit").click();
    await page.locator("[name=body]").focus();
    assert.equal(
      await page
        .locator("[name=body]")
        .evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
    await checkTheme(page, selectedTheme);
    await page.locator("[name=title]").focus();
    await checkTheme(page, selectedTheme);
    await page.locator("#search").focus();
    await checkTheme(page, selectedTheme);
    await page.locator("[name=source-url]").focus();
    await checkTheme(page, selectedTheme);
    await page.screenshot({
      path: "test-artifacts/wiki-theme-" + name + ".png",
      fullPage: true,
    });
    const opposite = selectedTheme === "dark" ? "light" : "dark";
    await setTheme(page, opposite);
    await checkTheme(page, opposite);
    await page.locator("#cancel").click();
    await page.reload();
    await expect(page.locator("#find")).toBeEnabled();
    assert.equal(
      await page.evaluate(() => localStorage.getItem("works_theme")),
      opposite,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      opposite,
    );
    await page.locator('[data-page="' + themePageId + '"]').click();
    await page.locator("[data-compare-proposal]").click();
    await checkTheme(page, opposite);
    await setTheme(page, "system");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("works_theme")),
      null,
    );
    await page.emulateMedia({ colorScheme: "dark" });
    await checkTheme(page, "dark");
    await page.emulateMedia({ colorScheme: "light" });
    await checkTheme(page, "light");
    await setTheme(page, selectedTheme);
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
    await checkTheme(page, selectedTheme);
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
