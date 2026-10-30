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
  await mkdir("test-artifacts", { recursive: true });
  for (const [name, viewport] of [
    ["desktop", { width: 1440, height: 1000 }],
    ["mobile", { width: 390, height: 844 }],
    ["compact", { width: 320, height: 844 }],
    ["tablet", { width: 768, height: 1000 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      acceptDownloads: true,
    });
    const page = await context.newPage();
    let failPatch = false, delayPatch = false,
      delayUpload = false,
      delayHistory = false,
      delaySection = false,
      delayBookCreate = false,
      bookCreateRequests = 0;
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
            body: `export const getGoogleAccessToken=async()=> 'fixture-google';export const getSessionToken=()=>${JSON.stringify(token)};export function watchAuth(o){queueMicrotask(()=>localStorage.fixtureSignedOut?o.onSignedOut():o.onSignedIn({email:'fixture@example.test'}))}export function signIn(path){localStorage.fixtureSignInPath=path;localStorage.fixtureDestination=localStorage.works_pending_destination}export async function signOutUser(){}`,
          });
        if (u.pathname.startsWith("/api/")) {
          if (failPatch && req.method()==='PATCH' && /^\/api\/kdp\/sections\/[^/]+$/.test(u.pathname))
            return route.fulfill({status:503,json:{error:'fixture save failed'}});
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
          contentType: (path.endsWith(".js") || path.endsWith(".mjs"))
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
    assert.equal(await page.locator("#home-navigation a:not([aria-current])").count(), 9);
    await page.locator("#dashboard-widgets .dashboard-widget").first().waitFor();
    assert.equal(await page.locator("#dashboard-widgets .dashboard-widget").count(), 3);
    await width();
    await page.screenshot({
      path: `test-artifacts/menu-${name}.png`,
      fullPage: true,
    });
    await page.locator('#home-navigation').evaluate(el=>el.open=true);
    await page.locator('#home-navigation a[href="/kdp/"]').click();
    await page.locator("#new-book").waitFor();
    await expect(page.locator('#new-book')).toBeVisible();
    await expect(page.locator('#new-book')).toHaveClass(/btn-solid/);
    const beforePresentation=JSON.stringify(await api('books')), beforeCreates=bookCreateRequests;
    await page.evaluate(async()=>{
      const {startKdpPresentation}=await import('/shared/ui/kdp-presentation.mjs');
      const c=startKdpPresentation();c.start();
      window.dispatchEvent(new Event('pagehide'));
      const b=document.createElement('button');b.type='button';b.id='kdp-ui-probe';document.body.append(b);
    });
    assert.equal(await page.locator('#kdp-ui-probe').getAttribute('class'),null);
    await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
    await expect(page.locator('#kdp-ui-probe')).toHaveClass(/btn/);
    await page.evaluate(()=>document.querySelector('#kdp-ui-probe').remove());
    assert.equal(bookCreateRequests,beforeCreates);
    assert.equal(JSON.stringify(await api('books')),beforePresentation);


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
    await page.locator("#modal").waitFor({ state: "hidden" });
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
    await page.locator("#back-books").click();
    assert.equal(await page.locator("#editor").isVisible(), true);
    await expect(page.locator("#section-title")).toBeEnabled();
    delaySection = false;
    delayHistory = true;
    await page.locator("#section-history").click();
    await expect(page.locator("#section-title")).toBeDisabled();
    await page.locator("#back-books").click();
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
    await page.locator("#modal").waitFor({ state: "hidden" });
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
    const beforeFailure=(await api('sections/'+section.id)).section;
    failPatch=true;
    await page.locator('#section-content').fill(original+' failed save');
    await page.locator('#save').click();
    await expect(page.locator('#message')).toContainText('fixture save failed');
    await expect(page.locator('#section-content')).toBeEnabled();
    await expect(page.locator('#section-content')).toHaveValue(original+' failed save');
    assert.equal((await api('sections/'+section.id)).section.body,beforeFailure.body);
    failPatch=false;
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
    await page.locator("#image-upload").setInputFiles({
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
    await expect(page.locator('#section-title')).toBeEnabled();
    await page.evaluate(async()=>{const {setTheme}=await import('/shared/theme.js?v=6');setTheme('dark');});
    await expect.poll(()=>page.locator('#section-title').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(30, 33, 38)');
    for(const id of ['section-title','image-upload']){
      const contrast=await page.locator('#'+id).evaluate(el=>{
        const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');
        const lum=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const a=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
        const s=getComputedStyle(el),a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert.ok(contrast>=4.5, `${id} dark text contrast ${contrast}`);
    }
    for(const id of ['section-title','image-upload']) {
      await page.locator('#'+id).focus();
      await page.locator('#'+id).scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#'+id).evaluate(el=>{const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===el||el.contains(hit);}),true,`${id} focus is not covered by sticky controls`);
      await page.screenshot({path:`test-artifacts/kdp-${name}-focused-${id}.png`});
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('#section-title').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`test-artifacts/kdp-${name}-dark.png`,fullPage:true});
    await page.emulateMedia({media:'print'});
    await page.pdf({path:`test-artifacts/kdp-${name}-print.pdf`,format:'A4'});
    await page.emulateMedia({media:'screen',reducedMotion:'no-preference'});
    await page.goto(origin + "/");
    await page.evaluate(() => {
      localStorage.fixtureSignedOut = "1";
    });
    await page.reload();
    await page.locator('#home-navigation').evaluate(el=>el.open=true);
    await page.locator('#home-navigation a[href="/kdp/"]').click();
    assert.equal(
      await page.evaluate(() => localStorage.fixtureDestination),
      "/kdp/",
    );
    await page.locator('#home-navigation').evaluate(el=>el.open=true);
    // A sign-in redirect is coalesced briefly to ignore accidental double taps.
    await page.waitForTimeout(1550);
    await page.locator('#home-navigation a[href="/todo/"]').click();
    assert.equal(
      await page.evaluate(() => localStorage.fixtureDestination),
      "/todo/",
    );
    await page.goto(origin + "/kdp/");
    await page.locator("#sign-in").click();
    assert.equal(
      await page.evaluate(() => localStorage.fixtureSignInPath),
      "/tutor/",
      "direct KDP login uses existing Google callback",
    );
    assert.equal(
      await page.evaluate(() => localStorage.works_pending_destination),
      "/kdp/",
    );
    const tutorSource = await readFile(new URL("tutor/app.js", root), "utf8");
    const safeRegexLiteral = tutorSource.match(
      /const SAFE_DESTINATION_RE = (.+);/,
    )[1];
    const safeRegex = Function("return (" + safeRegexLiteral + ")")();
    for (const path of ["/kdp/", "/todo/", "/material-print/"])
      assert.ok(safeRegex.test(path), "tutor callback permits " + path);
    for (const path of ["https://evil.test/", "//evil.test/", "/unknown/"])
      assert.equal(safeRegex.test(path), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(
    "PASS: isolated 320/390/768/1440 KDP creation, long mixed-language save, sources, proposals, restore, archive, export, unsaved guard, categories/auth destinations and viewport",
  );
} finally {
  if (browser) await browser.close();
  await mf.dispose();
}
