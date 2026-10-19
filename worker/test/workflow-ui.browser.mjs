import { chromium, expect } from "@playwright/test";
import { Miniflare } from "miniflare";
import { readFile, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { workflowExecute } from "../src/workflow.js";
const origin = "https://workflow.example.test",
  root = new URL("../../", import.meta.url);
const mf = new Miniflare({
  modules: true,
  script: 'export default {fetch(){return new Response("ok")}}',
  compatibilityDate: "2026-08-01",
  d1Databases: { DB: "wf-browser-synthetic" },
});
const env = {
  DB: await mf.getD1Database("DB"),
  ALLOWED_EMAIL: "owner@example.test",
  ALLOWED_ORIGIN: origin,
  SESSION_SECRET: "synthetic",
  WORKS_API_KEY: "synthetic",
};
const sql = await readFile(
  new URL("../workflow-migrations/0001-workflow.sql", import.meta.url),
  "utf8",
);
await env.DB.batch(
  sql
    .replace(/^--.*$/gm, "")
    .split(/(?=^CREATE )/m)
    .filter((s) => s.trim())
    .map((s) => env.DB.prepare(s)),
);
const payload = Buffer.from(
    JSON.stringify({ email: env.ALLOWED_EMAIL, exp: Date.now() + 3600000 }),
  ).toString("base64url"),
  token =
    payload +
    "." +
    createHmac("sha256", env.SESSION_SECRET)
      .update(payload)
      .digest("base64url");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
let writes = 0;
await context.route("**/*", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === "/shared/auth.js")
    return route.fulfill({
      contentType: "text/javascript",
      body: `export const getSessionToken=()=>${JSON.stringify(token)};export const signIn=()=>{};export const signOutUser=async()=>{};export const watchAuth=({onSignedIn})=>onSignedIn({email:'owner@example.test'});`,
    });
  if (url.pathname.startsWith("/api/")) {
    if (request.method() !== "GET") writes++;
    const response = await worker.fetch(
      new Request(url, {
        method: request.method(),
        headers: {
          Authorization: "Bearer " + token,
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(request.postData() ? { body: request.postData() } : {}),
      }),
      env,
    );
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  }
  const path = url.pathname.endsWith("/")
    ? url.pathname + "index.html"
    : url.pathname;
  try {
    return route.fulfill({
      contentType: path.endsWith(".js")
        ? "text/javascript"
        : path.endsWith(".css")
          ? "text/css"
          : "text/html",
      body: await readFile(new URL("." + path, root)),
    });
  } catch {
    return route.fulfill({ status: 404, body: "missing" });
  }
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
try {
  await page.goto(origin + "/workflow/");
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("#new").click();
  const f = page.locator("#definition-form");
  await f
    .locator("[name=title]")
    .fill("合成フロー <img src=x onerror=alert(1)>");
  await f.locator("[name=purpose]").fill("合成データだけで動作確認");
  await f.locator("[name=completion]").fill("成果物を本人が確認");
  await f.locator("[name=permissions]").fill("example.test の読み取りのみ");
  await f.locator("[name=repeat]").selectOption("hourly");
  const hoursInput = f.locator("[name=interval_hours]");
  await expect(hoursInput).toBeVisible();
  for (const value of ["", "0", "-1", "1.5", "8761"]) {
    await hoursInput.fill(value);
    assert.equal(await hoursInput.evaluate((el) => el.checkValidity()), false);
  }
  await hoursInput.fill("3");
  await f.locator("[name=start]").fill("2026-10-20T09:15");
  await f.locator("[name=task-title]").fill("根拠を整理");
  await f.locator("[name=task-completion]").fill("資料URLを確認");
  await f.getByRole("button", { name: "下書きを保存" }).click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(page.locator("#definitions")).toContainText("合成フロー <img");
  assert.equal(await page.locator("#definitions img").count(), 0);
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(hoursInput).toHaveValue("3");
  await expect(f.locator("[name=start]")).toHaveValue("2026-10-20T09:15");
  await f.locator("[name=title]").fill("週次レポートの作成（合成データ）");
  await f.getByRole("button", { name: "下書きを保存" }).click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await page.getByRole("button", { name: "内容を確認・実行を許可" }).click();
  await expect(page.locator("#definitions")).toContainText("実行許可済み");
  await expect(page.locator("#definitions")).toContainText("3時間ごと");
  await page.locator("#day").fill("2026-10-21");
  await page.locator("#day").dispatchEvent("change");
  await expect(
    page
      .locator(".wf-day")
      .filter({ has: page.getByRole("heading", { name: "10月21日(水)" }) })
      .locator(".wf-upcoming"),
  ).toHaveCount(8);
  const stored = await env.DB.prepare(
    "SELECT data FROM wf_definitions LIMIT 1",
  ).first();
  assert.equal(JSON.parse(stored.data).start, "2026-10-20T00:15:00.000Z");
  await page.locator("#today").click();
  await page.getByRole("button", { name: "手動実行", exact: true }).click();
  await expect(page.locator("#run-dialog")).toBeVisible();
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(page.locator("#run-detail > p").first()).toContainText(
    "一時停止 · 定義",
  );
  await page.getByRole("button", { name: "今回を再開", exact: true }).click();
  await expect(page.locator("#run-detail > p").first()).toContainText(
    "未着手 · 定義",
  );
  await page.locator("[data-close=run-dialog]").click();
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await page.locator("#day").fill("2026-12-01");
  await page.locator("#day").dispatchEvent("change");
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await page.locator("#today").click();
  await page.locator(".wf-settings > summary").click();
  await page.locator("#interval").selectOption("30");
  await page.locator("#save-interval").click();
  await expect(page.locator("#patrol-status")).toContainText("設定未反映");
  await expect(page.locator("#patrol-status")).toContainText("実際 未設定");
  // First dot task completes to a human gate; UI approval must verify evidence.
  const all = await env.DB.prepare("SELECT * FROM wf_runs LIMIT 1").first(),
    claim = await workflowExecute(env, {
      action: "claim",
      run_id: all.id,
      revision: all.revision,
    });
  await workflowExecute(env, {
    action: "complete",
    run_id: all.id,
    revision: claim.revision,
    generation: claim.generation,
    token: claim.token,
    result: "合成資料を確認",
    evidence: ["https://example.test/result"],
    criteria_verified: true,
  });
  await page.locator("#refresh").click();
  await page
    .locator("#filters")
    .getByRole("button", { name: /確認待ち/ })
    .click();
  await page.locator(".wf-run").first().click();
  await page.getByRole("button", { name: "確認して次へ" }).click();
  await expect(page.locator("#run-error")).toContainText("verified completion");
  await page.locator("[name=criteria_verified]").check();
  await page.locator("[name=workflow_criteria_verified]").check();
  await page.getByRole("button", { name: "確認して次へ" }).click();
  await expect(page.locator("#run-detail > p").first()).toContainText(
    "完了 · 定義",
  );
  await page.locator("[data-close=run-dialog]").click();
  await page.locator("#filters").getByRole("button", { name: /^完了/ }).click();
  await mkdir(new URL("../test-artifacts/workflow/", import.meta.url), {
    recursive: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: new URL("../test-artifacts/workflow/desktop.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  assert.equal(await page.locator(".wf-day:visible").count(), 7);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator(".wf-day:visible").count(), 1);
  const day = await page.locator("#day").inputValue();
  await page.locator("#next").click();
  assert.notEqual(await page.locator("#day").inputValue(), day);
  await page.locator("#prev").click();
  assert.equal(await page.locator("#day").inputValue(), day);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.evaluate(() => {
    localStorage.setItem("works_theme", "dark");
    document.documentElement.dataset.theme = "dark";
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: new URL("../test-artifacts/workflow/mobile-dark.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "全体停止", exact: true }).click();
  await expect(page.locator("#patrol-status")).toContainText("全体停止中");
  await page
    .getByRole("button", { name: "全体停止を解除", exact: true })
    .click();
  await expect(page.locator("#patrol-status")).not.toContainText("全体停止中");
  await page.goto(origin + "/");
  await expect(page.locator("#automation")).toContainText("ワークフロー");
  await expect(page.locator('#automation a[href="/wiki/"]')).toHaveCount(1);
  await expect(page.locator('#operations a[href="/wiki/"]')).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log(
    "Workflow desktop/mobile, dark theme, XSS, owner publish, stop/resume, verification gate, schedule status, home navigation passed; synthetic writes=" +
      writes,
  );
} finally {
  await browser.close();
  await mf.dispose();
}
