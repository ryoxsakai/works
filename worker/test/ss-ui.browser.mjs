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
  for (const width of [320, 390, 768, 1440]) {
    let failRead = false, delayRead = false, releaseRead;
    let projects = [
      { name: "Finished fixture", status: "完了", deadline: "2026-10-01" },
      { name: "Active fixture", status: "問題作成中", deadline: "2026-10-20", memo: "先頭行\n次の行" },
      { name: "Waiting fixture", status: "原稿待ち", deadline: "2026-10-10" },
    ];
    const original = JSON.stringify(projects),
      context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 700 }),
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
        if (delayRead) await new Promise(resolve => releaseRead=resolve);
        return route.fulfill(failRead ? {status:503,json:{error:'fixture unavailable'}} : { json: projects });
      }
      if (url.pathname === "/favicon.ico")
        return route.fulfill({ status: 204 });
      const path =
          url.pathname === "/ss/" ? "ss/index.html" : url.pathname.slice(1),
        types = { html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css" };
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
    assert.equal(await page.locator('.ss-memo').filter({hasText:'先頭行'}).textContent(), '先頭行\n次の行');
    assert.equal(await page.locator('#user-avatar-fallback').evaluate(el=>el.tagName.toLowerCase()),'svg');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#ss-show-completed').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await page.locator('input[name="works-theme"][value="light"]').check();
    assert.ok((await page.locator('#ss-sort-key').evaluate(el=>getComputedStyle(el).backgroundImage)).includes('%2300000080'));
    await page.locator('input[name="works-theme"][value="dark"]').check();
    assert.ok((await page.locator('#ss-sort-key').evaluate(el=>getComputedStyle(el).backgroundImage)).includes('%23ffffff80'));
    await page.keyboard.press('Escape');
    await page.screenshot({path:`test-artifacts/ss-${width}-dark.png`,fullPage:true});
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('tbody tr').count(),2);
    await page.pdf({path:`test-artifacts/ss-${width}-print.pdf`,format:'A4'});
    await page.emulateMedia({media:'screen'});
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
    failRead = true;
    await page.reload();
    await page.getByRole('alert').filter({hasText:'fixture unavailable'}).waitFor();
    assert.equal(await page.locator('#ss-empty').isVisible(),false);
    failRead = false;
    delayRead = true;
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#signed-in')?.hidden===false);
    assert.equal(await page.locator('#ss-empty').isVisible(),false);
    for(let attempt=0; !releaseRead && attempt<300; attempt++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(releaseRead, "delayed fixture request started");
    delayRead = false;
    releaseRead();
    await page.locator('#ss-empty').waitFor();
    assert.deepEqual([...new Set(methods)], ["GET"]);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`SS ${width}: PASS`);
  }
} finally {
  await browser.close();
}
