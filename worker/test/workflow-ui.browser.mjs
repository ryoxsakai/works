import { chromium, expect } from "@playwright/test";
import { Miniflare } from "miniflare";
import { readFile, mkdir } from "node:fs/promises";
import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { workflowExecute, workflowWrite } from "../src/workflow.js";
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
const roleSql = await readFile(
  new URL("../workflow-migrations/0002-roles.sql", import.meta.url),
  "utf8",
);
await env.DB.batch(
  roleSql
    .replace(/^--.*$/gm, "")
    .split(/(?=^CREATE )/m)
    .filter((s) => s.trim())
    .map((s) => env.DB.prepare(s)),
);
const stageSql = await readFile(
  new URL("../workflow-migrations/0003-staged-plans.sql", import.meta.url),
  "utf8",
);
await env.DB.batch(
  stageSql
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
let writes = 0,
  heldResponse = null,
  failNextWorkflowRead = false;
function holdResponse(method, action) {
  let reached, release;
  const started = new Promise((resolve) => {
      reached = resolve;
    }),
    resume = new Promise((resolve) => {
      release = resolve;
    });
  heldResponse = { method, action, reached, resume };
  return { started, release };
}
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
    if (url.pathname === "/api/workflow" && request.method() === "GET" && !url.search && failNextWorkflowRead) {
      failNextWorkflowRead = false;
      return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"synthetic refresh unavailable"})});
    }
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
    if (
      heldResponse &&
      request.method() === heldResponse.method &&
      (request.method() === "GET"
        ? !url.search
        : request.postDataJSON()?.action === heldResponse.action)
    ) {
      const hold = heldResponse;
      heldResponse = null;
      hold.reached();
      await hold.resume;
    }
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
      contentType:
        path.endsWith(".js") || path.endsWith(".mjs")
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
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error("Browser error:", e.message);
});
let acceptDialogs=true,beforeUnloadWarnings=0;
page.on("dialog", (d) => {if(d.type()==="beforeunload")beforeUnloadWarnings++;return acceptDialogs?d.accept():d.dismiss();});
try {
  await mkdir(new URL("../test-artifacts/workflow/", import.meta.url), {
    recursive: true,
  });
  // Empty first-use guide is navigation only; no real data or authorization writes.
  await page.goto(origin + "/workflow/");
  await expect(page.locator('#step-1')).toBeVisible();
  await expect(page.locator('#setup-guide')).toBeVisible();
  await expect(page.locator('#setup-back')).toBeDisabled();
  await page.locator('#setup-next').click();await expect(page.locator('#board-heading')).toBeFocused();
  await page.reload();await expect(page.locator('#step-2')).toBeVisible();await expect(page.locator('#setup-guide')).toBeVisible();
  await page.locator('#setup-back').click();await page.locator('#setup-cancel').click();
  await expect(page.locator('#step-2')).toBeVisible();await expect(page.locator('#setup-guide')).toBeHidden();
  await page.locator('#resume-setup').click();await expect(page.locator('#step-1')).toBeVisible();
  await page.locator('#new-role').click();await page.locator('#role-form [name=name]').fill('未保存の合成入力');
  acceptDialogs=false;await page.keyboard.press('Escape');await expect(page.locator('#role-editor')).toBeVisible();
  await page.goBack();await expect(page.locator('#role-editor')).toBeVisible();
  await page.evaluate(()=>location.reload());await expect.poll(()=>beforeUnloadWarnings).toBe(1);
  await expect(page.locator('#role-form [name=name]')).toHaveValue('未保存の合成入力');
  acceptDialogs=true;await page.locator('#close-role').click();await expect(page.locator('#new-role')).toBeFocused();
  await page.locator('#setup-next').click();await page.locator('#setup-next').click();
  await expect(page.locator('#step-3')).toBeVisible();await expect(page.locator('#active-runs')).toContainText('未完了の実行はありません');
  await page.locator('#setup-next').click();await expect(page.locator('#step-2')).toBeVisible();
  for(const id of ['definitions-dialog','planning-dialog','settings-dialog','history-dialog','filters-dialog']){
    const opener=page.locator(`[data-open="${id}"]`);await opener.click();await expect(page.locator('#'+id)).toBeVisible();
    await page.keyboard.press('Escape');await expect(opener).toBeFocused();
  }
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:1000});
    for(const step of [1,2,3]){await page.locator(`[data-step="${step}"]`).focus();await page.keyboard.press('Enter');await expect(page.locator('#step-'+step)).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../test-artifacts/workflow/step-${step}-${width}.png`,import.meta.url).pathname});}
    await page.locator('[data-step="2"]').click();
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-open="settings-dialog"]').click();await page.locator('#interval').selectOption('30');
  acceptDialogs=false;await page.keyboard.press('Escape');await expect(page.locator('#settings-dialog')).toBeVisible();
  acceptDialogs=true;await page.keyboard.press('Escape');await page.locator('[data-open="settings-dialog"]').click();await expect(page.locator('#interval')).toHaveValue('60');await page.keyboard.press('Escape');
  assert.equal(writes,0,'guide, dirty cancel, modal navigation never write data');
  await page.goto(origin + "/workflow/roles.html");
  await expect(page.locator("#workspace")).toBeVisible();
  await page.locator("#new-role").click();
  const roleForm = page.locator("#role-form");
  for (const [name, value] of Object.entries({
    name: "調査担当",
    responsibilities: "原典を確認",
    operations: "読み取りのみ",
    completion: "根拠を確認",
  }))
    await roleForm.locator(`[name=${name}]`).fill(value);
  await roleForm.locator("[name=color]").selectOption("sky");
  await roleForm.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#role-editor")).not.toBeVisible();
  await expect(page.locator("#roles")).toContainText("調査担当");
  await page.screenshot({
    path: new URL(
      "../test-artifacts/workflow/roles-desktop.png",
      import.meta.url,
    ).pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await page.goBack();
  await expect(page.locator("#role-editor")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "編集", exact: true }),
  ).toBeFocused();
  await page.evaluate(()=>sessionStorage.setItem('works_workflow_guide_v1',JSON.stringify({step:99,guiding:true})));
  await page.goto(origin + "/workflow/");
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator('#step-2')).toBeVisible();
  await expect(page.locator('#setup-guide')).toBeHidden();
  await page.locator("#new").click();
  const f = page.locator("#definition-form");
  await f.locator("[name=task-role]").selectOption({ label: "● 調査担当" });
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
  failNextWorkflowRead = true;
  await f.getByRole("button", { name: "下書きを保存" }).click();
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(page.locator("#error")).toContainText("下書きは保存しました");
  await page.locator("#refresh").click();
  await expect(page.locator("#definitions article")).toHaveCount(1);
  await expect(page.locator("#error")).toBeEmpty();
  await expect(page.locator("#definitions")).toContainText("合成フロー <img");
  assert.equal(await page.locator("#definitions img").count(), 0);
  await page.locator('[data-open="definitions-dialog"]').click();
  await page.getByRole("button", { name: "編集", exact: true }).click();
  await expect(hoursInput).toHaveValue("3");
  await expect(f.locator("[name=start]")).toHaveValue("2026-10-20T09:15");
  await f.locator("[name=title]").fill("週次レポートの作成（合成データ）");
  const savedRefresh = holdResponse("GET");
  await f.getByRole("button", { name: "下書きを保存" }).click();
  await savedRefresh.started;
  await expect(page.locator("#editor")).toBeVisible();
  await expect(page.locator("#workspace")).toHaveAttribute("aria-busy", "true");
  await expect(f.locator("[name=title]")).toBeDisabled();
  await expect(f.getByRole("button", {name:"下書きを保存"})).toBeDisabled();
  await expect(page.locator('[data-close="editor"]')).toBeEnabled();
  savedRefresh.release();
  await expect(page.locator("#editor")).not.toBeVisible();
  await expect(page.locator("#workspace")).toHaveAttribute("aria-busy", "false");
  await page.getByRole("button", { name: "内容を確認・実行を許可" }).click();
  await expect(page.locator("#definitions")).toContainText("実行許可済み");
  await expect(page.locator("#definitions")).toContainText("3時間ごと");
  await page.locator('[data-close="definitions-dialog"]').click();
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
  await page.locator('[data-open="definitions-dialog"]').click();
  await page.getByRole("button", { name: "手動実行", exact: true }).click();
  await expect(page.locator("#run-dialog")).toBeVisible();
  await page.getByText("配分案・未着手指示の改稿", { exact: true }).click();
  await page
    .getByLabel("指示案", { exact: true })
    .fill("原典を確認し出典を記録する");
  await page
    .getByLabel("理由・優先順位・期限・依存の確認", { exact: true })
    .fill("優先順位と期限を確認、現在工程なので前工程なし");
  await page.getByRole("button", { name: "配分案を保存", exact: true }).click();
  await expect(page.locator("#run-detail")).toContainText(
    "原典を確認し出典を記録する",
  );
  await page.getByText("配分案・未着手指示の改稿", { exact: true }).click();
  await page
    .getByRole("button", { name: "この案を確認・採用", exact: true })
    .click();
  await expect(page.locator("#run-detail")).toContainText(
    "採用済み指示：原典を確認し出典を記録する",
  );
  await page.screenshot({
    path: new URL("../test-artifacts/workflow/plan-modal.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "一時停止", exact: true }).click();
  await expect(page.locator("#run-detail > p").first()).toContainText(
    "一時停止 · 定義",
  );
  await page.getByRole("button", { name: "今回を再開", exact: true }).click();
  await expect(page.locator("#run-detail > p").first()).toContainText(
    "未着手 · 定義",
  );
  await page.locator("[data-close=run-dialog]").click();
  await page.locator('[data-close="definitions-dialog"]').click();
  await page.screenshot({
    path: new URL(
      "../test-artifacts/workflow/board-planned.png",
      import.meta.url,
    ).pathname,
    fullPage: true,
  });
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await page.locator("#workflow-search").fill("一致しない検索");
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await page.locator("#workflow-search").fill("");
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await page.locator('[data-step="3"]').click();
  await page.locator('[data-active="review"]').click();
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(0);
  await page.locator('[data-step="2"]').click();
  await expect(page.locator("#reset-filters")).toBeVisible();
  await page.locator("#workflow-search").fill("一致しない検索");
  await page.locator("#reset-filters").click();
  await expect(page.locator('[data-active="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await expect(page.locator("#workflow-search")).toBeFocused();
  await expect(page.locator("#reset-filters")).toBeHidden();
  await page.locator('[data-view="agenda"]').click();
  await expect(page.locator("#calendar")).toHaveClass(/wf-agenda/);
  await page.locator('[data-view="calendar"]').click();
  assert.equal(
    await page
      .locator("#refresh")
      .evaluate((el) => el.getBoundingClientRect().height),
    40,
  );

  await page.locator("#day").fill("2026-12-01");
  await page.locator("#day").dispatchEvent("change");
  await expect(page.locator("#active-runs .wf-run")).toHaveCount(1);
  await page.locator("#today").click();
  await page.locator('[data-open="settings-dialog"]').click();
  await page.locator("#interval").selectOption("30");
  await page.locator("#save-interval").click();
  await expect(page.locator("#patrol-status")).toContainText("設定未反映");
  await expect(page.locator("#patrol-status")).toContainText("実際 未設定");
  await page.locator('[data-close="settings-dialog"]').click();
  // First dot task completes to a human gate; UI approval must verify evidence.
  const all = await env.DB.prepare("SELECT * FROM wf_runs LIMIT 1").first(),
    claim = await workflowExecute(env, {
      action: "claim",
      role_id: JSON.parse(all.data).tasks[0].role_id,
      worker_id: "synthetic-role-worker",
      run_id: all.id,
      revision: all.revision,
    });
  await workflowExecute(env, {
    action: "complete",
    worker_id: "synthetic-role-worker",
    run_id: all.id,
    revision: claim.revision,
    generation: claim.generation,
    token: claim.token,
    result: "合成資料を確認",
    evidence: ["https://example.test/result"],
    criteria_verified: true,
  });
  await page.locator("#refresh").click();
  await expect(page.locator("#review-count")).toContainText("確認待ち 1件");
  await page.locator('[data-open="filters-dialog"]').click();
  await page
    .locator("#filters")
    .getByRole("button", { name: /確認待ち/ })
    .click();
  await page.locator('[data-close="filters-dialog"]').click();
  await page.locator('[data-step="3"]').click();
  await page.locator("#active-runs .wf-run").first().click();
  await page.getByRole("button", { name: "確認して次へ" }).click();
  await expect(page.locator("#run-error")).toContainText("verified completion");
  await page.locator("[name=criteria_verified]").check();
  await page.locator("[name=workflow_criteria_verified]").check();
  await page.getByRole("button", { name: "確認して次へ" }).click();
  await expect(page.locator("#run-detail > p").first()).toContainText(
    "完了 · 定義",
  );
  await page.locator("[data-close=run-dialog]").click();
  await page.locator('[data-step="2"]').click();
  await page.locator('[data-open="filters-dialog"]').click();
  await page.locator("#filters").getByRole("button", { name: /^完了/ }).click();
  await page.locator('[data-close="filters-dialog"]').click();
  await mkdir(new URL("../test-artifacts/workflow/", import.meta.url), {
    recursive: true,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: new URL("../test-artifacts/workflow/desktop.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  assert.equal(await page.locator(".wf-day:visible").count(), 4);
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
  // Regression: repeated explicit closes consume the history entry; no phantom Back stops.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/workflow/roles.html");
  for (let i = 0; i < 3; i++) {
    await page.locator("#new-role").click();
    await expect(page.locator("#role-editor")).toBeVisible();
    if (i % 2) await page.keyboard.press("Escape");
    else await page.locator("#close-role").click();
    await expect(page.locator("#new-role")).toBeFocused();
    await page.waitForFunction(() => !history.state?.workflowModal);
  }
  await page.goBack();
  await expect(page).toHaveURL(origin + "/");
  const base = await env.DB.prepare(
    "SELECT * FROM wf_definitions LIMIT 1",
  ).first();
  const original = JSON.parse(base.data);
  const laterDef = await workflowWrite(
    env,
    {
      action: "create",
      content: {
        ...original,
        title: "後の自動実行",
        kind: "automation",
        repeat: "once",
      },
    },
    true,
  );
  const published = await workflowWrite(
    env,
    {
      action: "publish",
      definition_id: laterDef.id,
      revision: laterDef.revision,
      authorized: true,
    },
    true,
  );
  let early = await workflowWrite(
    env,
    {
      action: "start",
      definition_id: base.id,
      revision: base.revision,
      request_id: "navigation-early",
    },
    true,
  );
  let late = await workflowWrite(
    env,
    {
      action: "start",
      definition_id: published.id,
      revision: published.revision,
      request_id: "navigation-late",
    },
    true,
  );
  const dayJP = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  for (const [r, hour] of [
    [early, "09"],
    [late, "17"],
  ]) {
    const suggestion = await workflowWrite(env, {
      action: "plan_suggest",
      run_id: r.id,
      revision: r.revision,
      plan: {
        role_id: r.data.tasks[0].role_id,
        instruction: r.data.tasks[0].title,
        planned_for: dayJP + "T" + hour + ":00:00+09:00",
        rationale: "日内の並び順の合成検証",
      },
    });
    await workflowWrite(
      env,
      {
        action: "plan_apply",
        run_id: r.id,
        revision: suggestion.revision,
        authorized: true,
      },
      true,
    );
  }
  await page.goto(origin + "/workflow/");
  await expect(page.locator("#workspace")).toBeVisible();
  const ordered = await page
    .locator(".wf-day.selected .wf-run")
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.runId));
  assert(
    ordered.indexOf(early.id) >= 0 &&
      ordered.indexOf(early.id) < ordered.indexOf(late.id),
    "day board is chronological across workflow/automation kinds",
  );
  await page.locator('[data-step="3"]').click();
  // Delayed POST and subsequent load must not resurrect a closed/Escaped/Back-dismissed modal.
  for (const [method, close] of [
    ["POST", "close"],
    ["GET", "escape"],
    ["POST", "back"],
    ["GET", "close"],
  ]) {
    await page.locator(`#active-runs [data-run-id="${early.id}"]`).click();
    await page.getByText("配分案・未着手指示の改稿", { exact: true }).click();
    await page
      .getByLabel("理由・優先順位・期限・依存の確認", { exact: true })
      .fill("遅延応答の合成検証");
    const hold = holdResponse(method, "plan_suggest");
    await page
      .getByRole("button", { name: "配分案を保存", exact: true })
      .click();
    await hold.started;
    if (close === "escape") await page.keyboard.press("Escape");
    else if (close === "back") await page.goBack();
    else await page.locator("[data-close=run-dialog]").click();
    await page.waitForFunction(() => !history.state?.workflowModal);
    hold.release();
    await expect(page.locator("#workspace")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator("#run-dialog")).not.toBeVisible();
  }
  // A newer run selected while an old mutation is pending stays selected after the old response.
  await page.locator(`#active-runs [data-run-id="${early.id}"]`).click();
  await page.getByText("配分案・未着手指示の改稿", { exact: true }).click();
  await page
    .getByLabel("理由・優先順位・期限・依存の確認", { exact: true })
    .fill("新しい詳細選択を保持");
  const hold = holdResponse("POST", "plan_suggest");
  await page.getByRole("button", { name: "配分案を保存", exact: true }).click();
  await hold.started;
  await page.locator("[data-close=run-dialog]").click();
  await page.waitForFunction(() => !history.state?.workflowModal);
  await page.locator(`#active-runs [data-run-id="${late.id}"]`).click();
  await expect(page.locator("#run-detail h3")).toHaveText("後の自動実行");
  hold.release();
  await expect(page.locator("#workspace")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.locator("#run-detail h3")).toHaveText("後の自動実行");
  await expect(page.locator("#run-dialog")).toBeVisible();
  await page.locator("[data-close=run-dialog]").click();
  await page.waitForFunction(() => !history.state?.workflowModal);
  // Future instances are planned in an inert staging record; no Run/job is created early.
  const futureStart = new Date(Date.now() + 3600000).toISOString();
  const futureDef = await workflowWrite(
    env,
    {
      action: "create",
      content: {
        ...original,
        title: "将来の交通整理",
        repeat: "once",
        start: futureStart,
        planning_policy: {
          enabled: true,
          revise_instructions: true,
          role_ids: [original.tasks[0].role_id],
        },
        tasks: [
          original.tasks[0],
          { ...original.tasks[0], title: "将来の照合" },
        ],
      },
    },
    true,
  );
  await workflowWrite(
    env,
    {
      action: "publish",
      definition_id: futureDef.id,
      revision: futureDef.revision,
      authorized: true,
    },
    true,
  );
  const runCount = (
    await env.DB.prepare("SELECT count(*) AS n FROM wf_runs").first()
  ).n;
  await page.goto(origin + "/workflow/");
  await expect(page.locator("#workspace")).toBeVisible();
  await page
    .locator(".wf-upcoming")
    .filter({ hasText: "将来の交通整理" })
    .getByRole("button", { name: "予定工程を調整" })
    .click();
  await expect(page.locator("#run-dialog h2")).toHaveText(
    "将来予定の交通整理（実行前）",
  );
  await expect(page.locator("#run-action")).not.toBeVisible();
  await page.getByText("配分案・未着手指示の改稿", { exact: true }).click();
  await page.locator("#planning-task-index").selectOption("1");
  await page
    .getByLabel("指示案", { exact: true })
    .fill("承認範囲内で原典と照合する");
  await page
    .getByLabel("予定（日本時間）", { exact: true })
    .fill(
      new Date(Date.parse(futureStart) + 9 * 3600000 + 1800000)
        .toISOString()
        .slice(0, 16),
    );
  await page
    .getByLabel("理由・優先順位・期限・依存の確認", { exact: true })
    .fill("前工程の後に配置");
  await page
    .getByRole("button", { name: "承認範囲内で反映", exact: true })
    .click();
  await expect(page.locator("#run-detail")).toContainText(
    "採用済み指示：承認範囲内で原典と照合する",
  );
  await page.screenshot({
    path: new URL("../test-artifacts/workflow/future-plan.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  await page.locator("[data-close=run-dialog]").click();
  await page.waitForFunction(() => !history.state?.workflowModal);
  await page.locator('[data-open="planning-dialog"]').click();
  await page.getByRole("button", { name: "配分案を計算", exact: true }).click();
  await expect(page.locator("#planning-status")).toContainText(
    "未反映の配分案",
  );
  await page
    .getByRole("button", { name: "事前承認の範囲内で配分", exact: true })
    .click();
  await expect(page.locator("#planning-status")).toContainText("配分を更新");
  assert.equal(
    (await env.DB.prepare("SELECT count(*) AS n FROM wf_runs").first()).n,
    runCount,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Workflow desktop/mobile, dark theme, XSS, owner publish, stop/resume, verification gate, schedule status, home navigation passed; synthetic writes=" +
      writes,
  );
} finally {
  await browser.close();
  await mf.dispose();
}
