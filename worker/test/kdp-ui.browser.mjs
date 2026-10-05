import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { chromium, expect } from "@playwright/test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
const origin = "https://works-kdp.test",
  root = new URL("../../", import.meta.url);
const mf = new Miniflare({
  modules: true,
  script: "export default {fetch(){return new Response('fixture')}}",
  compatibilityDate: "2026-08-01",
  d1Databases: { DB: "kdp-ui" },
  r2Buckets: ["MATERIALS_BUCKET"],
});
let browser;
try {
  const env = {
    DB: await mf.getD1Database("DB"),
    MATERIALS_BUCKET: await mf.getR2Bucket("MATERIALS_BUCKET"),
    SESSION_SECRET: "synthetic-ui-secret",
    ALLOWED_EMAIL: "fixture@example.test",
    ALLOWED_ORIGIN: origin,
  };
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
      new Request(origin + "/api/kdp/" + path, {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Origin: origin,
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
      : process.platform === "darwin"
        ? {
            executablePath:
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {}),
  });
  await mkdir("test-artifacts", { recursive: true });
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    let delayPatch = false,
      delayUpload = false;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      try {
        if (u.origin !== origin)
          return route.fulfill({
            status: 200,
            body: "",
            contentType: "text/css",
          });
        if (u.pathname === "/shared/auth.js")
          return route.fulfill({
            contentType: "text/javascript",
            body: `export const getSessionToken=()=>${JSON.stringify(token)};export function watchAuth(o){queueMicrotask(()=>localStorage.fixtureSignedOut?o.onSignedOut():o.onSignedIn({email:'fixture@example.test'}))}export function signIn(){localStorage.fixtureDestination=localStorage.works_pending_destination}export async function signOutUser(){}`,
          });
        if (u.pathname.startsWith("/api/")) {
          if (
            (delayPatch && req.method() === "PATCH") ||
            (delayUpload &&
              u.pathname.endsWith("/images") &&
              req.method() === "POST")
          )
            await new Promise((resolve) => setTimeout(resolve, 700));
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
        const path = u.pathname.endsWith("/")
          ? u.pathname + "index.html"
          : u.pathname;
        await route.fulfill({
          body: await readFile(new URL("." + path, root)),
          contentType: path.endsWith(".js")
            ? "text/javascript"
            : path.endsWith(".css")
              ? "text/css"
              : path.endsWith(".html")
                ? "text/html"
                : "application/octet-stream",
        });
      } catch (e) {
        errors.push(e.message);
        await route.fulfill({ status: 500, body: e.message });
      }
    });
    const width = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        name + " fits viewport",
      );
    const saveDialog = async () => {
      await page.locator("#dialog-form button[type=submit]").click();
      await page.locator("#modal").waitFor({ state: "hidden" });
    };
    await page.goto(origin + "/");
    assert.equal(await page.locator(".module-card").count(), 7);
    assert.equal(await page.locator(".module-section").count(), 3);
    await width();
    await page.screenshot({
      path: `test-artifacts/menu-${name}.png`,
      fullPage: true,
    });
    await page.locator('a[href="/kdp/"]').click();
    await page.locator("#new-book").waitFor();
    await page.locator("#new-book").click();
    await page
      .getByLabel("本タイトル", { exact: true })
      .fill("日本 / English " + name);
    await page.getByLabel("想定読者").fill("English readers / 海外読者");
    await saveDialog();
    await page.locator("#new-chapter").click();
    await page.getByLabel("章タイトル").fill("制度 / Systems");
    await saveDialog();
    await page.getByRole("button", { name: "＋ 節", exact: true }).click();
    await page
      .locator("#dialog-form")
      .getByLabel("節タイトル", { exact: true })
      .fill("概要 / Overview");
    await saveDialog();
    const original =
      "日本語と English.\n<script>escaped</script>\n" +
      "Long manuscript sentence. ".repeat(500);
    await page.locator("#section-content").fill(original);
    await page.locator("#save").click();
    await page.getByText("原稿を保存しました。", { exact: true }).waitFor();
    await width();
    await page.locator("#new-source").click();
    await page.getByLabel("出典名").fill("Official source");
    await page.getByLabel("出典URL").fill("https://example.test/source");
    await page.getByLabel("確認日").fill("2026-10-05");
    await page.getByLabel("対象年度").fill("2027");
    await saveDialog();
    await page
      .locator("#sources")
      .getByText("Official source", { exact: true })
      .waitFor();
    await page.locator("#section-content").fill(original + " unsaved");
    let seen = false;
    page.once("dialog", async (d) => {
      seen = true;
      await d.dismiss();
    });
    await page.locator("#back-books").click();
    assert.ok(seen);
    assert.ok(
      (await page.locator("#section-content").inputValue()).endsWith(
        " unsaved",
      ),
    );
    await page.locator("#section-content").fill(original);
    await page.locator("#save").click();
    await page.getByText("原稿を保存しました。", { exact: true }).waitFor();
    const books = await api("books"),
      book = books.books.find((b) => b.title === "日本 / English " + name),
      details = await api("books/" + book.id),
      section = details.chapters[0].sections[0];
    const reopen = async () => {
      await page.reload();
      await page.locator(`[data-book="${book.id}"]`).click();
      await page.locator(`[data-section="${section.id}"]`).click();
    };
    await api("sections/" + section.id + "/proposals", {
      title: "ChatGPT案",
      body: "改訂版 / Revised text",
      base_revision: section.revision,
    });
    await reopen();
    await page.locator("#proposals button").first().click();
    await width();
    await page.locator("#accept-proposal").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
    await expect(page.locator("#section-content")).toHaveValue(
      "改訂版 / Revised text",
    );
    const current = (await api("sections/" + section.id)).section;
    await api("sections/" + section.id + "/proposals", {
      title: "却下する案",
      body: "Rejected",
      base_revision: current.revision,
    });
    await reopen();
    await page
      .locator("#proposals .item")
      .filter({ hasText: "却下する案" })
      .getByRole("button")
      .click();
    await page.locator("#reject-proposal").click();
    await page.locator("#modal").waitFor({ state: "hidden" });
    await expect(page.locator("#section-content")).toHaveValue(
      "改訂版 / Revised text",
    );
    await page.locator("#section-history").click();
    page.once("dialog", (d) => d.accept());
    await page.locator('[data-restore="2"]').click();
    await page.locator("#modal").waitFor({ state: "hidden" });
    await expect(page.locator("#section-content")).toHaveValue(original);
    await page.locator("#section-archive").click();
    await page
      .getByRole("button", { name: "アーカイブから戻す", exact: true })
      .waitFor();
    await page.locator("#show-archived").check();
    await page.locator("#section-archive").click();
    await page
      .getByRole("button", { name: "アーカイブ", exact: true })
      .waitFor();
    delayPatch = true;
    await page.locator("#section-content").fill(original + " delayed");
    await page.locator("#save").click();
    await expect(page.locator("#section-content")).toBeDisabled();
    await expect(page.locator("#section-title")).toBeDisabled();
    await page.locator("#back-books").click();
    assert.equal(await page.locator("#editor").isVisible(), true);
    await page.getByText("原稿を保存しました。", { exact: true }).waitFor();
    delayPatch = false;
    delayUpload = true;
    await page
      .locator("#image-upload")
      .setInputFiles({
        name: "synthetic.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await expect(page.locator("#section-content")).toBeDisabled();
    await page.locator("#back-books").click();
    assert.equal(await page.locator("#editor").isVisible(), true);
    await expect(page.locator("#section-content")).toBeEnabled();
    assert.ok(
      (await page.locator("#section-content").inputValue()).includes(
        "kdp-image:",
      ),
    );
    delayUpload = false;
    await page.locator("#save").click();
    await page.getByText("原稿を保存しました。", { exact: true }).waitFor();
    for (const format of ["epub", "json", "markdown"]) {
      const promise = page.waitForEvent("download");
      await page.locator(`[data-export="${format}"]`).click();
      assert.equal(await (await promise).failure(), null);
    }
    await page.locator("#section-content").scrollIntoViewIfNeeded();
    await page.locator("#section-content").focus();
    await page.locator("#save").scrollIntoViewIfNeeded();
    const rect = await page.locator("#save").boundingBox();
    assert.ok(rect.y >= 0 && rect.y + rect.height <= viewport.height);
    await width();
    await page.screenshot({
      path: `test-artifacts/kdp-${name}.png`,
      fullPage: true,
    });
    await page.goto(origin + "/");
    await page.evaluate(() => {
      localStorage.fixtureSignedOut = "1";
    });
    await page.reload();
    await page.locator('a[href="/kdp/"]').click();
    assert.equal(
      await page.evaluate(() => localStorage.fixtureDestination),
      "/kdp/",
    );
    await page.locator('a[href="/todo/"]').click();
    assert.equal(
      await page.evaluate(() => localStorage.fixtureDestination),
      "/todo/",
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: isolated desktop/mobile KDP creation, long mixed-language save, sources, proposals, restore, archive, export, unsaved guard, categories/auth destinations and viewport",
  );
} finally {
  if (browser) await browser.close();
  await mf.dispose();
}
