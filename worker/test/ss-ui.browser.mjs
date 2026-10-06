// All requests intercepted with synthetic fixtures; never writes production data.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const origin = "https://works-ss.test",
  root = new URL("../../", import.meta.url);
const browser = await chromium.launch({
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
try {
  for (const width of [1440, 390]) {
    let projects = [
      { name: "Finished fixture", status: "完了", deadline: "2026-10-01" },
      { name: "Active fixture", status: "問題作成中", deadline: "2026-10-20" },
      { name: "Waiting fixture", status: "原稿待ち", deadline: "2026-10-10" },
    ];
    const original = JSON.stringify(projects),
      context = await browser.newContext({ viewport: { width, height: 844 } }),
      page = await context.newPage(),
      errors = [],
      methods = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== origin) return route.fulfill({ status: 204 });
      if (url.pathname === "/shared/auth.js")
        return route.fulfill({
          contentType: "text/javascript",
          body: 'export const getSessionToken=()=>"fixture";export const signOutUser=async()=>{};export const watchAuth=({onSignedIn})=>onSignedIn({email:"fixture@example.test"});',
        });
      if (url.pathname === "/api/ss-projects") {
        methods.push(req.method());
        return route.fulfill({ json: projects });
      }
      if (url.pathname === "/favicon.ico")
        return route.fulfill({ status: 204 });
      const path =
          url.pathname === "/ss/" ? "ss/index.html" : url.pathname.slice(1),
        types = { html: "text/html", js: "text/javascript", css: "text/css" };
      try {
        return route.fulfill({
          body: await readFile(new URL(path, root)),
          contentType:
            types[path.split(".").pop()] || "application/octet-stream",
        });
      } catch {
        return route.fulfill({ status: 404 });
      }
    });
    await page.goto(origin + "/ss/");
    await page.getByText("Active fixture", { exact: true }).waitFor();
    const toggle = page.getByRole("checkbox", { name: "完了を表示" });
    assert.equal(await toggle.isChecked(), false);
    assert.equal(
      await page.getByText("Finished fixture", { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator("#ss-project-list tr").count(), 2);
    assert.match(
      await page.locator("#ss-summary").innerText(),
      /進行中 2件／全3件/,
    );
    await toggle.check();
    assert.equal(await page.locator("#ss-project-list tr").count(), 3);
    if (width > 700)
      await page.getByRole("button", { name: "進捗", exact: false }).click();
    else await page.locator("#ss-sort-key").selectOption("status");
    assert.equal(
      await page.getByText("Finished fixture", { exact: true }).count(),
      1,
    );
    await toggle.uncheck();
    assert.equal(await page.locator("#ss-project-list tr").count(), 2);
    assert.equal(
      await page.getByText("Finished fixture", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.ok(
      (await page.locator(".ss-completed-toggle").boundingBox()).height >= 44,
    );
    await mkdir("test-artifacts", { recursive: true });
    await page.screenshot({
      path: `test-artifacts/ss-${width}.png`,
      fullPage: true,
    });
    await toggle.check();
    await page.reload();
    await page.getByText("Active fixture", { exact: true }).waitFor();
    assert.equal(await toggle.isChecked(), false);
    assert.equal(JSON.stringify(projects), original);
    projects = [projects[0]];
    await page.reload();
    await page.locator("#ss-empty").waitFor();
    assert.match(
      await page.locator("#ss-empty").innerText(),
      /進行中のプロジェクトはありません/,
    );
    await toggle.check();
    assert.equal(await page.locator("#ss-project-list tr").count(), 1);
    assert.equal(await page.locator("#ss-empty").isVisible(), false);
    projects = [];
    await page.reload();
    await page.locator("#ss-empty").waitFor();
    assert.match(
      await page.locator("#ss-empty").innerText(),
      /登録中のプロジェクトはありません/,
    );
    assert.deepEqual([...new Set(methods)], ["GET"]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`SS ${width}: PASS`);
  }
} finally {
  await browser.close();
}
