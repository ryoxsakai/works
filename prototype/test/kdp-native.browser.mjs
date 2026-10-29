import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import { chromium, expect } from "../../worker/node_modules/@playwright/test/index.mjs";
import { Miniflare } from "../../worker/node_modules/miniflare/dist/src/index.js";
import worker from "../../worker/src/index.js";
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
  async function api(path, body, method = body ? "POST" : "GET") {
    const r = await worker.fetch(
      new Request(origin + "/api/kdp/" + path, {
        method,
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
  await mkdir("test-artifacts/production", { recursive: true });
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
      delayUpload = false,
      delayHistory = false,
      delaySection = false,
      delayBookCreate = false,
      bookCreateRequests = 0, lostPatch=false, lostCreate=false, expire=false;
    const requests=[];
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      try {
        if (u.origin !== origin) return route.abort();
        if (u.pathname === "/shared/auth.js")
          return route.fulfill({
            contentType: "text/javascript",
            body: `export const getSessionToken=()=>${JSON.stringify(token)};export function watchAuth(o){window.authCount=(window.authCount||0)+1;queueMicrotask(()=>localStorage.fixtureSignedOut?o.onSignedOut():o.onSignedIn({email:'fixture@example.test'}))}export function signIn(path){localStorage.fixtureSignInPath=path;localStorage.fixtureDestination=localStorage.works_pending_destination}export async function signOutUser(){}`,
          });
        if (u.pathname.startsWith("/api/")) {
          assert.ok(u.pathname.startsWith('/api/kdp/'));requests.push({path:u.pathname,method:req.method()});if(expire)return route.fulfill({status:401,json:{error:'Synthetic expiry'}});

          if (u.pathname === "/api/kdp/books" && req.method() === "POST")
            bookCreateRequests++;
          if (
            (delayBookCreate &&
              u.pathname === "/api/kdp/books" &&
              req.method() === "POST") ||
            (delayHistory &&
              u.pathname.endsWith("/history") &&
              req.method() === "GET") ||
            (delaySection &&
              /^\/api\/kdp\/sections\/[^/]+$/.test(u.pathname) &&
              req.method() === "GET") ||
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
          if(lostCreate&&u.pathname==='/api/kdp/books'&&req.method()==='POST'&&r.ok){lostCreate=false;return route.fulfill({status:502,json:{error:'Synthetic lost create response'}});}
          if(lostPatch&&req.method()==='PATCH'&&r.ok){lostPatch=false;return route.fulfill({status:502,json:{error:'Synthetic lost response after commit'}});}
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
      await page.locator("#modal").waitFor({ state: "hidden" });await expect(page.locator(".kdp-native")).toHaveAttribute("aria-busy","false");
    };
    await page.goto(origin + '/app/#!/kdp/');
    await page.locator("#new-book").waitFor();
    await page.locator("#new-book").click();
    await page
      .getByLabel("本タイトル", { exact: true })
      .fill("日本 / English " + name);
    await page.getByLabel("想定読者").fill("English readers / 海外読者");
    assert.equal(
      await page
        .locator("#dialog-form input[name=title]")
        .getAttribute("maxlength"),
      "300",
    );
    delayBookCreate = true;
    await page.locator("#dialog-form").evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await expect(
      page.locator("#dialog-form button[type=submit]"),
    ).toBeDisabled();
    await expect(page.locator("#modal-close")).toBeDisabled();
    await page.keyboard.press("Escape");
    assert.equal(
      await page.locator("#modal").isVisible(),
      true,
      "pending dialog cannot close",
    );
    await page.locator("#dialog-form input[name=title]").press("Enter");
    await page.locator("#modal").waitFor({ state: "hidden" });await expect(page.locator(".kdp-native")).toHaveAttribute("aria-busy","false");
    delayBookCreate = false;
    assert.equal(
      bookCreateRequests,
      1,
      "repeated submit sends one create request",
    );
    assert.equal(
      (await api("books")).books.filter(
        (b) => b.title === "日本 / English " + name,
      ).length,
      1,
      "one book exists",
    );
    await page.locator("#new-chapter").click();
    await page.getByLabel("章タイトル").fill("制度 / Systems");
    await saveDialog();
    await page.getByRole("button", { name: "＋ 節", exact: true }).click();
    await page
      .locator("#dialog-form")
      .getByLabel("節タイトル", { exact: true })
      .fill("概要 / Overview");
    await saveDialog();
    assert.equal(
      await page.locator("#section-title").getAttribute("maxlength"),
      "300",
    );
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
    let logoutPrompt=false;page.once('dialog',async d=>{logoutPrompt=true;await d.dismiss();});await page.locator('[data-sign-out]').click();assert.ok(logoutPrompt);await expect(page.locator('#section-content')).toHaveValue(original+' unsaved');
    let seen = false;
    page.once("dialog", async (d) => {
      seen = true;
      await d.dismiss();
    });
    await page.locator("#back-books").evaluate(b=>b.click());
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
      const acceptBefore=d=>d.type()==='beforeunload'?d.accept():d.dismiss();page.on('dialog',acceptBefore);await page.reload();page.off('dialog',acceptBefore);
      await page.locator(`[data-book="${book.id}"]`).click();
      await page.locator(`[data-section="${section.id}"]`).click();
      await expect(page.locator("#section-title")).toBeEnabled();
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
    await page.locator("#modal").waitFor({ state: "hidden" });await expect(page.locator(".kdp-native")).toHaveAttribute("aria-busy","false");
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
    await page.locator("#modal").waitFor({ state: "hidden" });await expect(page.locator(".kdp-native")).toHaveAttribute("aria-busy","false");
    await expect(page.locator("#section-content")).toHaveValue(
      "改訂版 / Revised text",
    );
    for (let n = 0; n < 12; n++) {
      const latest = (await api("sections/" + section.id)).section;
      await api(
        "sections/" + section.id,
        { revision: latest.revision, body: "history revision " + n },
        "PATCH",
      );
    }
    await reopen();
    delaySection = true;
    await page.locator(`[data-section="${section.id}"]`).click();
    await expect(page.locator("#section-title")).toBeDisabled();
    await page.locator("#back-books").evaluate(b=>b.click());
    assert.equal(await page.locator("#editor").isVisible(), true);
    await expect(page.locator("#section-title")).toBeEnabled();
    delaySection = false;
    delayHistory = true;
    await page.locator("#section-history").click();
    await expect(page.locator("#section-title")).toBeDisabled();
    await page.locator("#back-books").evaluate(b=>b.click());
    assert.equal(await page.locator("#editor").isVisible(), true);
    await expect(page.locator("[data-restore]")).toHaveCount(10);
    await expect(page.locator("#section-title")).toBeEnabled();
    delayHistory = false;
    await page
      .getByRole("button", { name: "以前の履歴を読み込む", exact: true })
      .click();
    await page.locator('[data-restore="2"]').waitFor();
    page.once("dialog", (d) => d.accept());
    await page.locator('[data-restore="2"]').click();
    await page.locator("#modal").waitFor({ state: "hidden" });await expect(page.locator(".kdp-native")).toHaveAttribute("aria-busy","false");
    await expect(page.locator("#section-content")).toHaveValue(original);
    await expect(page.locator("#section-title")).toBeEnabled();
    await page.locator("#section-archive").click();
    await page
      .getByRole("button", { name: "アーカイブから戻す", exact: true })
      .waitFor();
    await page.locator("#show-archived").check();
    await page.locator("#section-archive").click();
    await page
      .getByRole("button", { name: "アーカイブ", exact: true })
      .waitFor();
    await expect(page.locator("#section-title")).toBeEnabled();
    delayPatch = true;
    await page.locator("#section-content").fill(original + " delayed");
    await page.locator("#save").click();
    await expect(page.locator("#section-content")).toBeDisabled();
    await expect(page.locator("#section-title")).toBeDisabled();
    await page.locator("#back-books").evaluate(b=>b.click());
    assert.equal(await page.locator("#editor").isVisible(), true);
    await page.getByText("原稿を保存しました。", { exact: true }).waitFor();
    delayPatch = false;
    delayUpload = true;
    await page.locator("#image-upload").setInputFiles({
      name: "synthetic.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.locator("#section-content")).toBeDisabled();
    await page.locator("#back-books").evaluate(b=>b.click());
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
      path: `test-artifacts/production/kdp-native-${name}.png`,
      fullPage: true,
    });
    await page.locator('#book-settings').click();await page.locator('#dialog-form [name=subtitle]').fill('Synthetic subtitle');await saveDialog();assert.equal((await api('books/'+book.id)).book.subtitle,'Synthetic subtitle');
    await page.locator('#new-chapter').click();await page.getByLabel('章タイトル').fill('Second synthetic chapter');await saveDialog();const two=(await api('books/'+book.id)).chapters;assert.equal(two.length,2);await page.locator('[data-move-chapter="'+two[0].id+'"][data-direction="1"]').click();await expect(page.locator('.kdp-native')).toHaveAttribute('aria-busy','false');assert.equal((await api('books/'+book.id)).chapters[0].id,two[1].id);
    await page.locator('[data-edit-chapter="'+two[1].id+'"]').click();await page.locator('#dialog-form [name=title]').fill('Renamed chapter');await saveDialog();await page.locator('[data-edit-chapter="'+two[1].id+'"]').click();await page.locator('#archive-chapter').click();await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('.kdp-native')).toHaveAttribute('aria-busy','false');assert.equal((await api('books/'+book.id)).chapters.find(c=>c.id===two[1].id).archived,1);await page.locator('[data-edit-chapter="'+two[1].id+'"]').click();await page.locator('#archive-chapter').click();await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('.kdp-native')).toHaveAttribute('aria-busy','false');
    await page.locator('#sources [data-edit-source]').first().click();await page.locator('#dialog-form [name=notes]').fill('Synthetic source note');await saveDialog();await expect(page.locator('#sources')).toContainText('Synthetic source note');
    await page.locator('#new-proposal').click();await page.locator('#dialog-form [name=title]').fill('Native UI draft');await page.locator('#dialog-form [name=body]').fill('Not adopted');await saveDialog();const acceptedBefore=(await api('sections/'+section.id)).section.body;await page.locator('#proposals .item').filter({hasText:'Native UI draft'}).getByRole('button').click();await expect(page.locator('#modal .diff')).toContainText('Not adopted');assert.equal((await api('sections/'+section.id)).section.body,acceptedBefore);await page.locator('#reject-proposal').click();await expect(page.locator('#modal')).toBeHidden();await expect(page.locator('.kdp-native')).toHaveAttribute('aria-busy','false');assert.equal((await api('sections/'+section.id)).section.body,acceptedBefore);
    // Lost committed save stops writes and preserves exact input/receipt, never replaying.
    await page.locator('#section-content').fill('Unknown committed text');lostPatch=true;const before=requests.filter(r=>r.method==='PATCH').length;await page.locator('#save').click();await expect(page.locator('[data-kdp-recovery]')).toBeVisible();await expect(page.locator('#save')).toBeDisabled();await expect(page.locator('#section-content')).toHaveValue('Unknown committed text');assert.equal((await api('sections/'+section.id)).section.body,'Unknown committed text');await page.locator('[data-inspect]').click();await expect(page.locator('[data-kdp-recovery] pre')).toContainText('Unknown committed text');assert.equal(requests.filter(r=>r.method==='PATCH').length,before+1);const receipt=page.waitForEvent('download');await page.locator('[data-receipt]').click();assert.equal(await(await receipt).failure(),null);
    await reopen();const latest=(await api('sections/'+section.id)).section;await api('sections/'+section.id,{revision:latest.revision,body:'Other synthetic writer'},'PATCH');await page.locator('#section-content').fill('Stale local text');await page.locator('#save').click();await expect(page.locator('[data-kdp-recovery]')).toBeVisible();await expect(page.locator('#section-content')).toHaveValue('Stale local text');assert.equal((await api('sections/'+section.id)).section.body,'Other synthetic writer');
    await reopen();assert.equal(await page.evaluate(()=>authCount),1);await page.locator('#back-books').click();await page.locator('#new-book').click();await page.locator('#dialog-form [name=title]').fill('Unknown create '+name);lostCreate=true;const createsBefore=bookCreateRequests;await page.locator('#dialog-form [type=submit]').click();await expect(page.locator('[data-kdp-recovery]')).toBeVisible();assert.equal(bookCreateRequests,createsBefore+1);assert.equal((await api('books')).books.filter(b=>b.title==='Unknown create '+name).length,1);await page.locator('[data-inspect]').click();await expect(page.locator('[data-kdp-recovery] pre')).toContainText('Unknown create '+name);assert.equal(bookCreateRequests,createsBefore+1);await expect(page.locator('#dialog-form [name=title]')).toHaveValue('Unknown create '+name);
    expire=true;const acceptReload=d=>d.accept();page.on('dialog',acceptReload);await page.reload();page.off('dialog',acceptReload);await expect(page.locator('#auth-screen')).toBeVisible();await expect(page.locator('#app')).toBeHidden();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS native KDP: actual synthetic D1/R2 original book/chapter/section/body/source/proposal explicit review/history/restore/archive/image/exports, unknown committed saves no replay, stale CAS, busy and unsaved guards, responsive/auth lifecycle",
  );
} finally {
  if (browser) await browser.close();
  await mf.dispose();
}
