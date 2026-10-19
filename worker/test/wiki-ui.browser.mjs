import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
const legacyMarkdown = await readFile(
  new URL("./fixtures/wiki-legacy-markdown.js", import.meta.url),
  "utf8",
);
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
  await page.waitForFunction(
    (expected) =>
      getComputedStyle(document.documentElement).colorScheme === expected,
    theme,
  );
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
          ".source,.proposal,#history > div,#pages small,#detail p,#detail h1,#detail h2,#detail h3,#detail h4,#detail a,#detail button,#detail pre,#editor input,#editor select,#editor textarea,#editor label,#editor button,#message,#search,#folder-dialog input,#folder-dialog select,#folder-dialog button,#folder-dialog h2,#folder-dialog-message",
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
  // Visible controls vary between listing, viewing, editing and dialogs.
  await expect(page.locator("#search")).toBeVisible();
  if (await page.locator("#folder-dialog").isVisible()) {
    await expect(page.locator("#folder-dialog-title")).toBeVisible();
    await expect(page.locator("#folder-dialog-submit")).toBeVisible();
    assert.ok(results.some((r) => r.element === "folder-dialog-submit"));
  }
  assert.ok(results.some((r) => r.element === "search"));
  assert.ok(results.length > 0);
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
    const { setTheme } = await import("/shared/theme.js?v=6");
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
  for (const migration of ["0001-wiki.sql", "0002-wiki-folders.sql"]) {
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
        // Emulate a returning browser whose unversioned renderer is still cached.
        if (u.pathname === "/wiki/markdown.js" && !u.search)
          return route.fulfill({
            contentType: "text/javascript",
            body: legacyMarkdown,
          });
        if (u.pathname === "/shared/auth.js")
          return route.fulfill({
            contentType: "text/javascript",
            body: `export const getSessionToken=()=>${JSON.stringify(token)};export function watchAuth(o){queueMicrotask(()=>localStorage.fixtureSignedOut ? o.onSignedOut() : o.onSignedIn())}export function signIn(path){window.fixtureSignInPath=path}export async function signOutUser(){}`,
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
          contentType: /\.m?js$/.test(p)
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
    await page
      .locator("[name=body]")
      .fill("# Heading\n\nSafe **knowledge**\n\n## Details\n\nMore knowledge");
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
    const editHeight = await page
      .locator("#edit")
      .evaluate((el) => el.getBoundingClientRect().height);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            getComputedStyle(document.querySelector("#edit"))
              .backgroundColor ===
            getComputedStyle(document.querySelector("#new")).backgroundColor,
        ),
      )
      .toBe(true);
    assert.equal(editHeight, name.startsWith("mobile") ? 44 : 40);
    await page.locator("#focus-reading").click();
    await expect(page.locator("#folder-browser")).not.toBeVisible();
    await page.locator("#focus-reading").click();
    await expect(page.locator("#folder-browser")).toBeVisible();

    await page.locator("#page-outline summary").click();
    await expect(page.locator("#page-toc a")).toHaveCount(2);
    await page.locator("#page-toc a").last().click();
    await expect(page.locator("#body h2")).toHaveAttribute(
      "id",
      "wiki-section-1",
    );
    await page.locator("#edit").click();
    await page.locator("[name=body]").fill("proposed knowledge");
    await page.locator("#proposal-notes").fill("synthetic proposal");
    await page.locator("#propose").click();
    await expect(page.locator("#proposals")).toContainText(
      "synthetic proposal",
    );
    await expect(page.locator("#body")).toContainText("Safe knowledge");
    await expect(page.locator("#proposal-heading")).toContainText(
      "確認待ち 1件",
    );
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
    await page.locator('#pages [data-page="' + themePageId + '"]').click();
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
    let acceptDialogs = true;
    page.on("dialog", (d) => (acceptDialogs ? d.accept() : d.dismiss()));
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
    await page.locator('#pages [data-page="' + id + '"]').click();
    await expect(page.locator("#body")).toContainText("external change");
    // Editing is a focused workspace: cancel before returning to history.
    await page.locator("#edit").click();
    await page.locator("[name=body]").fill("old form");
    await expect(page.locator("#wiki-layout")).not.toBeVisible();
    await page.locator("#cancel").click();
    await page.locator('[data-restore="1"]').click();
    await expect(page.locator("#editor")).toBeHidden();
    await expect(page.locator("#body")).toContainText("Safe knowledge");
    const download = page.waitForEvent("download");
    await page.locator("[data-export=json]").click();
    assert.match((await download).suggestedFilename(), /\.json$/);
    await page.locator("#archive").click();
    await expect(page.locator("#meta")).toContainText("アーカイブ");
    await expect(page.locator("#move-page")).toBeHidden();
    await page.reload();
    await expect(page.locator("#title")).toHaveText(name + " knowledge");
    await expect(page.locator("#move-page")).toBeHidden();
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
    // Material-library patterns: folder dialog, breadcrumb, cards and details tree.
    await page.locator('#folder-breadcrumb [data-folder-open=""]').click();
    await expect(page.locator("#find")).toBeEnabled();
    async function createFolder(title) {
      await page.locator("#new-folder").click();
      await expect(page.locator("#folder-dialog")).toBeVisible();
      await expect(page.locator("#folder-dialog-submit")).toBeEnabled();
      await page.locator("#folder-name").fill(title);
      await page.locator("#folder-name").focus();
      await checkTheme(page, selectedTheme);
      await page.locator("#folder-dialog-submit").click();
      await expect(page.locator("#folder-dialog")).toBeHidden();
      await expect(page.locator("#find")).toBeEnabled();
      return (await api("folders")).folders.find((f) => f.name === title);
    }
    const parentFolder = await createFolder(name + " Parent");
    await page
      .locator('#folder-grid [data-folder-open="' + parentFolder.id + '"]')
      .click();
    await expect(page.locator("#find")).toBeEnabled();
    const childFolder = await createFolder(name + " Child");
    await page
      .locator('#folder-grid [data-folder-open="' + childFolder.id + '"]')
      .click();
    await expect(page.locator("#find")).toBeEnabled();
    await page.locator("#view-tree").click();
    await expect(
      page
        .locator(
          '#folder-tree details[data-folder="' +
            parentFolder.id +
            '"] details[data-folder="' +
            childFolder.id +
            '"]',
        )
        .first(),
    ).toBeVisible();
    await page.locator("#view-folders").click();
    await page.locator("#rename-folder").click();
    await expect(page.locator("#folder-dialog-submit")).toBeEnabled();
    await page.locator("#folder-name").fill(name + " Renamed");
    await page.locator("#folder-dialog-submit").click();
    await expect(page.locator("#folder-heading")).toContainText("Renamed");
    await expect(page.locator("#find")).toBeEnabled();
    await page.locator("#move-folder").click();
    await expect(page.locator("#folder-dialog-submit")).toBeEnabled();
    assert.equal(
      await page
        .locator('#folder-target option[value="' + childFolder.id + '"]')
        .count(),
      0,
      "Cycle destination excluded",
    );
    await page.locator("#folder-target").selectOption("");
    await page.locator("#folder-dialog-submit").click();
    await expect(page.locator("#folder-dialog")).toBeHidden();
    await expect(page.locator("#find")).toBeEnabled();
    assert.equal(
      (await api("folders")).folders.find((f) => f.id === childFolder.id)
        .parent_id,
      null,
    );
    await page.locator("#new").click();
    await page.locator("[name=title]").fill(name + " Rich Markdown");
    const rich =
      "# Rich heading\n\nParagraph with *emphasis* and **bold**.\n\n1. first\n2. second\n\n- parent\n  - nested\n\n> quotation\n\n| A | B |\n|---|---|\n| x | y |\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\n- [x] Read-only task";
    await page.locator("[name=body]").fill(rich);
    await page.locator("#mode-preview").click();
    for (const selector of [
      "h1",
      "em",
      "strong",
      "ol",
      "ul",
      "blockquote",
      "table",
      "pre code",
    ])
      await expect(
        page.locator("#editor-preview " + selector).first(),
      ).toBeVisible();
    assert.equal(await page.locator("#editor-preview pre").count(), 1);
    await expect(
      page.locator("#editor-preview input[type=checkbox]"),
    ).toBeDisabled();
    await page.locator("#mode-edit").click();
    await expect(page.locator("[name=body]")).toHaveValue(rich);
    await page
      .locator("[name=body]")
      .fill(
        '<img src=x onerror="window.__wikiPayload=1">\n[x](javascript:alert(1))',
      );
    await page.locator("#mode-preview").click();
    assert.equal(
      await page
        .locator(
          '#editor-preview img,#editor-preview script,#editor-preview svg,#editor-preview a[href^="javascript:"]',
        )
        .count(),
      0,
    );
    assert.equal(await page.evaluate(() => window.__wikiPayload), undefined);
    await page.locator("#mode-edit").click();
    await page.locator("[name=body]").fill(rich);
    await page.screenshot({
      path: "test-artifacts/wiki-editor-" + name + ".png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "本文として保存", exact: true })
      .click();
    await expect(page.locator("#title")).toHaveText(name + " Rich Markdown");
    await expect(page.locator("#find")).toBeEnabled();
    await expect(page.locator("#body table td")).toHaveCount(2);
    await expect(page.locator("#body em")).toHaveText("emphasis");
    const richId = await page
      .locator("#pages button")
      .filter({ hasText: name + " Rich Markdown" })
      .getAttribute("data-page");
    assert.equal((await api("pages/" + richId)).page.folder_id, childFolder.id);
    await page.locator("#move-page").click();
    await expect(page.locator("#folder-dialog-submit")).toBeEnabled();
    await page.locator("#folder-target").selectOption(parentFolder.id);
    await page.locator("#folder-dialog-submit").click();
    await expect(page.locator("#folder-dialog")).toBeHidden();
    await expect(page.locator("#find")).toBeEnabled();
    const moved = (await api("pages/" + richId)).page;
    assert.equal(moved.folder_id, parentFolder.id);
    assert.equal(moved.revision, 2);
    assert.equal(moved.body, rich);
    await page.locator("#move-page").click();
    await expect(page.locator("#folder-dialog-submit")).toBeEnabled();
    await page.locator("#folder-target").selectOption(childFolder.id);
    const dest = (await api("folders")).folders.find(
      (f) => f.id === childFolder.id,
    );
    await api("folders/" + dest.id, {
      name: name + " Updated elsewhere",
      parent_id: null,
      revision: dest.revision,
    });
    await page.locator("#folder-dialog-submit").click();
    await expect(page.locator("#folder-dialog-message")).toContainText(
      "入力は保持",
    );
    await expect(page.locator("#folder-dialog")).toBeVisible();
    assert.equal((await api("pages/" + richId)).page.revision, 2);
    await page.locator("#folder-dialog-cancel").click();
    await expect(page.locator("#folder-dialog")).toBeHidden();
    await page.locator("#edit").click();
    await page.locator("[name=body]").fill("unsaved navigation");
    acceptDialogs = false;
    await page.locator("#view-tree").click();
    await expect(page.locator("#editor")).toBeVisible();
    await expect(page.locator("[name=body]")).toHaveValue("unsaved navigation");
    const beforeBack = page.url();
    await page.goBack();
    await expect(page.locator("[name=body]")).toHaveValue("unsaved navigation");
    await expect(page).toHaveURL(beforeBack);
    acceptDialogs = true;
    await page.locator("#cancel").click();
    await page.locator("#back-folders").click();
    await expect(page.locator("#detail")).toBeHidden();
    await expect(page.locator("#find")).toBeEnabled();
    await page.goBack();
    await expect(page.locator("#title")).toHaveText(name + " Rich Markdown");
    await expect(page.locator("#find")).toBeEnabled();
    await page.locator("#view-tree").click();
    await expect(page.locator("#folder-sidebar")).toBeVisible();
    await expect(
      page.locator('#folder-tree [data-page="' + richId + '"]'),
    ).toBeVisible();
    await page.locator('#folder-tree [data-page="' + richId + '"]').click();
    await expect(
      page.locator('#folder-tree [data-page="' + richId + '"]'),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.locator('#pages [data-page="' + richId + '"]'),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator("#find")).toBeEnabled();
    await page.locator("#new-folder").click();
    await expect(page.locator("#folder-dialog-submit")).toBeEnabled();
    await page.locator("#folder-name").fill("cancelled folder");
    acceptDialogs = false;
    await page.keyboard.press("Escape");
    await expect(page.locator("#folder-dialog")).toBeVisible();
    acceptDialogs = true;
    await page.locator("#folder-dialog-cancel").click();
    await expect(page.locator("#folder-dialog")).toBeHidden();
    assert.ok(
      !(await api("folders")).folders.some(
        (f) => f.name === "cancelled folder",
      ),
    );
    await checkTheme(page, selectedTheme);
    await page.locator("#view-folders").click();
    await expect(page.locator("#folder-sidebar")).toBeHidden();
    await page.screenshot({
      path: "test-artifacts/wiki-" + name + ".png",
      fullPage: true,
    });
    // Linked page belongs to another folder; label must use global metadata.
    const linked = await api("pages", {
      title: name + " linked elsewhere",
      body: "linked",
      sources: [],
      tags: [],
      aliases: [],
      links: [],
      status: "draft",
    });
    const original = (await api("pages/" + richId)).page;
    await api("pages/" + richId + "/save", {
      revision: original.revision,
      content: { ...original, links: [linked.page.id] },
    });
    await page.goto(origin + "/wiki/?page=" + richId);
    await expect(page.locator("#links button")).toHaveText(
      name + " linked elsewhere",
    );
    await expect(page.locator("#move-page")).toBeVisible();
    // Sign-in stays on the registered callback, retaining only identifier queries.
    const deepPath = "/wiki/?folder=" + original.folder_id + "&page=" + richId;
    await page.evaluate(() => {
      localStorage.fixtureSignedOut = "1";
    });
    await page.goto(origin + deepPath + "&redirect=https://external.test");
    await page.locator("#sign-in").click();
    assert.equal(
      await page.evaluate(() => localStorage.works_pending_destination),
      deepPath,
    );
    assert.equal(
      await page.evaluate(() => window.fixtureSignInPath),
      "/tutor/",
    );
    await page.evaluate(() => {
      delete localStorage.fixtureSignedOut;
    });
    await page.goto(origin + deepPath);
    await expect(page.locator("#title")).toHaveText(name + " Rich Markdown");
    // Long labels must wrap in cards, trees and reading views on mobile too.
    await page.goto(origin + "/wiki/");
    const longFolderName = name + " " + "長いフォルダ名".repeat(25);
    const longFolder = await createFolder(longFolderName);
    await page.goto(origin + "/wiki/?folder=" + longFolder.id);
    await page.locator("#new").click();
    const longTitle = "長いページタイトル".repeat(25);
    await page.locator("[name=title]").fill(longTitle);
    await page.locator("[name=body]").fill(rich);
    await page
      .getByRole("button", { name: "本文として保存", exact: true })
      .click();
    await expect(page.locator("#title")).toHaveText(longTitle);
    await page.locator("#view-tree").click();
    await expect(page.locator("#folder-sidebar")).toBeVisible();
    await checkTheme(page, selectedTheme);
    await page.locator("#search").fill("no-matching-page-unique-query");
    await page.locator("#find").click();
    await expect(page.locator("#pages .wiki-empty")).toContainText(
      "一致するページがありません",
    );
    await checkTheme(page, selectedTheme);
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
