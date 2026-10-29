import {
  chromium,
  expect,
} from "../../worker/node_modules/@playwright/test/index.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = path.join(root, "test-artifacts/dashboard");
await fs.mkdir(artifacts, { recursive: true });
const base = "https://works-dashboard.test";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE }
    : {}),
});
const auth = `export const getSessionToken=()=> 'fixture-session';export const getGoogleAccessToken=async()=> window.qaHoldGoogle ? new Promise(resolve=>window.qaReleaseGoogle=()=>resolve('fixture-google')) : 'fixture-google';export const signIn=()=>{window.qaSignIn=(window.qaSignIn||0)+1;};export const signOutUser=async()=>{window.qaSignOut=true;};export const watchAuth=callbacks=>{window.qaAuth=callbacks;if(!localStorage.qaSignedOut)callbacks.onSignedIn({email:localStorage.qaEmail||'dashboard@example.test',picture:''});else callbacks.onSignedOut();};`;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
let passed = [];
const fullPageEvidence = [];
async function fullPageAtTop(page, options) {
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const geometry = await page.evaluate(() => ({
    scrollY,
    headerTop: document.querySelector(".page-header").getBoundingClientRect()
      .top,
  }));
  fullPageEvidence.push({ file: path.basename(options.path), ...geometry });
  assert.equal(geometry.scrollY, 0);
  assert.ok(Math.abs(geometry.headerTop) < 1);
  return page.screenshot(options);
}

async function fixture(options = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    timezoneId: "America/Los_Angeles",
    hasTouch: !!options.touch,
  });
  const requests = [],
    errors = [];
  let failTodo = !!options.failTodo,
    holdTodo = !!options.holdTodo,
    releaseTodo,
    holdMemo = !!options.holdMemo,
    releaseMemo;
  const tasks = [
    { name: "持ち越しの教材確認", plannedDay: "2026-10-28", status: "doing" },
    {
      name: "今日の授業準備",
      plannedDay: "2026-10-29",
      deadline: "2026-10-30",
    },
    { name: "締切だけのタスク", deadline: "2026-10-28" },
    { name: "完了した作業", plannedDay: "2026-10-29", progress: 100 },
    { name: "次週の予定", plannedDay: "2026-11-02" },
  ];
  if (options.large)
    tasks.push(
      ...Array.from({ length: 4 }, (_, i) => ({
        name: `本日締切追加 ${i + 1}`,
        deadline: "2026-10-29",
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `期限超過追加 ${i + 1}`,
        deadline: "2026-10-27",
      })),
      ...Array.from({ length: 7 }, (_, i) => ({
        name: `予定追加 ${i + 1}`,
        plannedDay: "2026-10-29",
      })),
    );
  await ctx.route("**/*", async (r) => {
    const u = new URL(r.request().url());
    requests.push({ url: u.pathname + u.search, method: r.request().method() });
    if (u.origin !== base) {
      if (u.origin === "https://www.googleapis.com" && options.empty)
        return r.fulfill({ json: { items: [] } });
      if (u.origin === "https://www.googleapis.com")
        return r.fulfill({
          json: {
            items: [
              {
                id: "same",
                summary: "サンプル生徒 A",
                start: { dateTime: "2026-10-29T10:00:00+09:00" },
                end: { dateTime: "2026-10-29T11:00:00+09:00" },
              },
              {
                id: "same2",
                summary: "サンプル生徒 B",
                start: { dateTime: "2026-10-29T14:30:00+09:00" },
                end: { dateTime: "2026-10-29T15:30:00+09:00" },
              },
              {
                summary: "除外",
                start: { dateTime: "2026-10-29T09:00:00+09:00" },
              },
            ],
          },
        });
      return r.abort();
    }
    if (u.pathname === "/shared/auth.js")
      return r.fulfill({ contentType: "text/javascript", body: auth });
    if (u.pathname === "/api/todo") {
      if (holdTodo) await new Promise((resolve) => (releaseTodo = resolve));
      return r
        .fulfill(
          failTodo
            ? { status: 503, json: { error: "fixture" } }
            : { json: { tasks: options.empty ? [] : tasks } },
        )
        .catch(() => {});
    }
    if (u.pathname === "/api/settings")
      return r.fulfill({
        json: { selected_calendars: ["fixture"], excluded_titles: ["除外"] },
      });
    if (u.pathname === "/api/memo") {
      if (holdMemo) await new Promise((resolve) => (releaseMemo = resolve));
      return r
        .fulfill({
          json: {
            memos: [
              { title: "日付だけのメモ", updatedAt: "2026-10-28" },
              {
                title: "授業で使う表現",
                body: "BODY MUST NEVER APPEAR",
                notes: "PRIVATE",
                updatedAt: "2026-10-29T11:00:00Z",
              },
            ],
          },
        })
        .catch(() => {});
    }
    if (u.pathname === "/api/material-library/files")
      return r.fulfill({
        json: [
          {
            name: "サンプル教材.pdf",
            created_at: "2026-10-28 10:00:00",
            object_key: "PRIVATE-KEY",
          },
        ],
      });
    if (u.pathname === "/api/ss-projects")
      return r.fulfill({
        json: [
          {
            name: "サンプル問題制作",
            status: "問題作成中",
            deadline: "2026-10-30",
          },
          { name: "完了案件", status: "完了", deadline: "2026-10-29" },
        ],
      });
    if (u.pathname.startsWith("/api/"))
      throw Error("Unexpected API " + u.pathname);
    const file = path.join(
      root,
      u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname,
    );
    try {
      return r.fulfill({
        body: await fs.readFile(file),
        contentType: mime[path.extname(file)] || "application/octet-stream",
      });
    } catch {
      return r.fulfill({ status: 404, body: "fixture missing" });
    }
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date("2026-10-29T12:00:00Z") });
  if (options.init) await page.addInitScript(options.init);
  await page.goto(base + "/");
  return {
    ctx,
    page,
    requests,
    errors,
    release() {
      holdTodo = false;
      releaseTodo?.();
      holdMemo = false;
      releaseMemo?.();
    },
    recover() {
      failTodo = false;
    },
    async close() {
      this.release();
      await ctx.close();
    },
  };
}
async function ready(page) {
  await expect(page.locator('[data-content="todo"]')).toContainText(
    "持ち越しの教材確認",
  );
  await expect(page.locator('[data-content="lessons"]')).toContainText(
    "サンプル生徒 A",
  );
  await expect(page.locator("#dashboard-edit")).toBeEnabled();
}
try {
  const f = await fixture();
  const { page } = f;
  await ready(page);
  assert.equal(
    await page.locator("#home-navigation a:not([aria-current])").count(),
    9,
  );
  assert.equal(await page.locator(".dashboard-widget").count(), 3);
  assert.ok(
    !(await page.locator('[data-content="lessons"]').innerText()).includes(
      "除外",
    ),
  );
  await expect(page.locator('[data-content="todo"]')).not.toContainText(
    "完了した作業",
  );
  await expect(page.locator('[data-content="todo"]')).not.toContainText(
    "次週の予定",
  );
  assert.ok(f.requests.every((r) => r.method === "GET"));
  assert.ok(
    !f.requests.some((r) =>
      /lesson-record|lesson-plan|curriculum|\/api\/schedule/.test(r.url),
    ),
  );
  assert.ok(
    !f.requests.some((r) =>
      /\/api\/memo|material-library|ss-projects/.test(r.url),
    ),
  );
  await fullPageAtTop(page, {
    path: path.join(artifacts, "desktop-default-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#home-navigation")).not.toHaveAttribute("open");
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.locator(".dashboard-widget").first()).toHaveAttribute(
    "data-id",
    "lessons",
  );
  assert.ok(
    (
      await page
        .locator('[data-content="lessons"] strong')
        .first()
        .boundingBox()
    ).y < 700,
    "lesson content visible in mobile first screen",
  );
  await fullPageAtTop(page, {
    path: path.join(artifacts, "mobile-default-390.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed.push(
    "default widgets, all nine original routes, JST planned/deadline distinction, GET-only safe endpoints and lazy optional widgets",
  );
  await page.locator("#dashboard-edit").click();
  await page.locator('[data-add="memo"]').click();
  await expect(page.locator('[data-content="memo"]')).toContainText(
    "授業で使う表現",
  );
  await expect(page.locator("body")).not.toContainText(
    "BODY MUST NEVER APPEAR",
  );
  await page.locator('[data-add="materials"]').click();
  await expect(page.locator('[data-content="materials"]')).toContainText(
    "サンプル教材.pdf",
  );
  await expect(page.locator("body")).not.toContainText("PRIVATE-KEY");
  await page.locator('[data-add="ss"]').click();
  await expect(page.locator('[data-content="ss"]')).toContainText(
    "サンプル問題制作",
  );
  await expect(page.locator('[data-content="ss"]')).not.toContainText(
    "完了案件",
  );
  await expect(page.locator('[data-content="memo"]')).toContainText(
    "更新 2026/10/29 20:00 JST",
  );
  await expect(page.locator('[data-content="memo"]')).toContainText(
    "更新 2026/10/28（日付のみ）",
  );
  await expect(page.locator('[data-content="materials"]')).toContainText(
    "追加 2026/10/28 19:00 JST",
  );
  await expect(page.locator('[data-content="todo"]')).toContainText(
    "締切 2026-10-30",
  );
  await expect(page.locator(".dashboard-widget")).toHaveCount(6);
  const headerEvidence = [];
  const captureHeader = async (label, ratio) => {
    await page.evaluate(
      (r) =>
        scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * r),
      ratio,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const metrics = await page.evaluate(() => ({
      scrollY,
      viewport: { width: innerWidth, height: innerHeight },
      headerTop: document.querySelector(".page-header").getBoundingClientRect()
        .top,
      headerBottom: document
        .querySelector(".page-header")
        .getBoundingClientRect().bottom,
      position: getComputedStyle(document.querySelector(".page-header"))
        .position,
    }));
    headerEvidence.push({ label, ...metrics });
    assert.ok(
      Math.abs(metrics.headerTop) < 1,
      label + " header remains at viewport top",
    );
    await page.screenshot({
      path: path.join(artifacts, "viewport-header-" + label + ".png"),
      fullPage: false,
    });
  };
  headerEvidence.push({
    label: "after all-widget edit actions before recapture",
    scrollY: await page.evaluate(() => scrollY),
  });
  for (const [label, ratio] of [
    ["top", 0],
    ["middle", 0.5],
    ["bottom", 1],
  ])
    await captureHeader(label, ratio);
  await page.setViewportSize({ width: 390, height: 844 });
  await captureHeader("after-resize-edit", 0.5);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#home-navigation a[href="/todo/"]')).toBeVisible();
  const coverage = [];
  const controls = page.locator(
    "a[href],button:not(:disabled),input:not(:disabled),summary",
  );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.locator("#home-navigation").evaluate((el) => (el.open = true));
    for (let i = 0; i < (await controls.count()); i++) {
      const c = controls.nth(i);
      if (!(await c.isVisible())) continue;
      await c.focus();
      const m = await c.evaluate((el) => {
        const r = el.getBoundingClientRect(),
          hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
        return {
          control:
            el.getAttribute("aria-label") || el.textContent.trim() || el.id,
          top: r.top,
          bottom: r.bottom,
          covered: !(hit === el || el.contains(hit)),
          cover: hit?.tagName,
        };
      });
      coverage.push({ width, ...m });
    }
  }
  await fs.writeFile(
    path.join(artifacts, "header-viewport-evidence.json"),
    JSON.stringify({ headerEvidence, coverage }, null, 2),
  );
  assert.deepEqual(
    coverage.filter((c) => c.covered),
    [],
    "focused controls must be reachable without an overlay",
  );
  passed.push(
    "actual top/middle/bottom/resized viewport header stays at top; all visible focused controls remain unobscured",
  );
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await fullPageAtTop(page, {
    path: path.join(artifacts, "desktop-all-widgets-1440.png"),
    fullPage: true,
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `full catalog overflow ${width}`,
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#dashboard-editor").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(artifacts, "mobile-edit-390.png"),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#open-home-settings").click();
  await page.locator('input[name="home-theme"][value="dark"]').check();
  await page.locator("#home-settings-close").click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await fullPageAtTop(page, {
    path: path.join(artifacts, "desktop-dark-all-widgets-1440.png"),
    fullPage: true,
  });
  await page.locator("#open-home-settings").click();
  await page.locator('input[name="home-theme"][value="light"]').check();
  await page.locator("#home-settings-close").click();
  await page.locator('[data-move="memo"][data-step="-1"]').focus();
  await page.locator('[data-move="memo"][data-step="-1"]').press("Enter");
  await expect(page.locator(".dashboard-widget").nth(2)).toHaveAttribute(
    "data-id",
    "memo",
  );
  await page.locator("#dashboard-cancel").click();
  assert.equal(await page.locator(".dashboard-widget").count(), 3);
  assert.equal(
    await page.evaluate(() =>
      Object.keys(localStorage).some((k) =>
        k.startsWith("works-home-dashboard"),
      ),
    ),
    false,
  );
  passed.push(
    "optional catalogs, metadata/title-only rendering, accessible reorder, cancel creates no persistence",
  );
  await page.locator("#dashboard-edit").click();
  await page.waitForFunction(() =>
    window.Sortable?.get(document.querySelector("#dashboard-widgets")),
  );
  await fullPageAtTop(page, {
    path: path.join(artifacts, "desktop-edit-1440.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1800 });
  const handle = await page
      .locator('[data-id="todo"] .drag-handle')
      .boundingBox(),
    target = await page
      .locator('[data-id="lessons"] .drag-handle')
      .boundingBox();
  await page.mouse.move(handle.x + 20, handle.y + 20);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width - 10, target.y + 20, {
    steps: 25,
  });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .locator(".dashboard-widget")
        .evaluateAll((es) => es.map((e) => e.dataset.id).join(",")),
    )
    .not.toBe("lessons,todo,shortcuts");
  await page.locator("#dashboard-cancel").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed.push(
    "real desktop drag handle reorders draft; cancel restores canonical order",
  );

  await page.locator("#dashboard-edit").click();
  await page.locator('[data-hide="lessons"]').click();
  await page.locator('[data-move="shortcuts"][data-step="-1"]').click();
  await page.locator("#dashboard-save").click();
  const stored = await page.evaluate(() =>
    Object.entries(localStorage).filter(([k]) =>
      k.startsWith("works-home-dashboard"),
    ),
  );
  assert.equal(stored.length, 1);
  assert.ok(!stored[0][0].includes("@"));
  assert.ok(!stored[0][1].includes("教材確認"));
  const oldCalls = f.requests.filter((r) => r.url === "/api/settings").length;
  await page.reload();
  await expect(page.locator(".dashboard-widget").first()).toHaveAttribute(
    "data-id",
    "shortcuts",
  );
  await expect(page.locator("#dashboard-edit")).toBeEnabled();
  assert.equal(
    f.requests.filter((r) => r.url === "/api/settings").length,
    oldCalls,
  );
  passed.push(
    "user-hashed layout only persistence, reload and disabled-widget no-fetch",
  );
  await page.evaluate(() =>
    window.qaAuth.onSignedIn({ email: "other@example.test", picture: "" }),
  );
  await expect(page.locator('[data-id="lessons"]')).toBeVisible();
  await expect(page.locator("#dashboard-edit")).toBeEnabled();
  assert.equal(
    await page.locator(".dashboard-widget").first().getAttribute("data-id"),
    "lessons",
  );
  await page.evaluate(() =>
    window.qaAuth.onSignedIn({ email: "dashboard@example.test", picture: "" }),
  );
  await expect(page.locator(".dashboard-widget").first()).toHaveAttribute(
    "data-id",
    "shortcuts",
  );
  await expect(page.locator("#dashboard-edit")).toBeEnabled();
  passed.push("per-user account-switch layout isolation");

  await page.locator("#dashboard-edit").click();
  await page.locator('[data-add="memo"]').click();
  page.once("dialog", (d) => d.dismiss());
  await page.locator('#home-navigation a[href="/todo/"]').click();
  assert.equal(new URL(page.url()).pathname, "/");
  await page.locator("#dashboard-cancel").click();
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.locator("#dashboard-edit").click();
  await page.locator('[data-hide="todo"]').click();
  await page.locator("#dashboard-save").click();
  await expect(page.locator("#dashboard-message")).toContainText(
    "保存できません",
  );
  await expect(page.locator("#dashboard-editor")).toBeVisible();
  await page.locator("#dashboard-cancel").click();
  await expect(page.locator('[data-id="todo"]')).toBeVisible();
  passed.push(
    "navigation cancel and storage quota failure preserve saved layout/draft recovery",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#home-navigation")).not.toHaveAttribute("open");
  await page.locator("#home-navigation summary").click();
  await expect(page.locator('#home-navigation a[href="/kdp/"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#home-navigation summary")).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator('#home-navigation a[href="/wiki/"]')).toBeVisible();
  await page.locator('#home-navigation a[href="/wiki/"]').focus();
  await expect(page.locator('#home-navigation a[href="/wiki/"]')).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("#home-navigation summary")).toBeFocused();
  await fullPageAtTop(page, {
    path: path.join(artifacts, "mobile-reordered-390.png"),
    fullPage: true,
  });
  for (const width of [320, 375, 390, 768, 900, 1440, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "overflow " + width,
    );
  }
  passed.push(
    "320–1920px no overflow, collapsible mobile routes, Escape and resize focus recovery",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#open-home-settings").click();
  await page.locator('input[name="home-theme"][value="dark"]').check();
  await page.locator("#home-settings-close").click();
  await expect(page.locator("#open-home-settings")).toBeFocused();
  await fullPageAtTop(page, {
    path: path.join(artifacts, "mobile-dark-390.png"),
    fullPage: true,
  });
  passed.push("legacy theme settings, dark screenshot and dialog focus return");
  assert.deepEqual(f.errors, []);
  await f.close();
  const delayed = await fixture({ holdTodo: true });
  await expect(delayed.page.locator('[data-content="lessons"]')).toContainText(
    "サンプル生徒 A",
  );
  await delayed.page.locator("#home-auth-action").click();
  delayed.release();
  await expect(delayed.page.locator("#home-auth-action")).toHaveAttribute(
    "aria-label",
    "Googleでログイン",
  );
  await expect(delayed.page.locator("body")).not.toContainText(
    "持ち越しの教材確認",
  );
  await expect(delayed.page.locator("body")).not.toContainText(
    "サンプル生徒 A",
  );
  assert.deepEqual(delayed.errors, []);
  await delayed.close();
  passed.push(
    "delayed request logout clears private data and rejects late responses",
  );
  const failure = await fixture({ failTodo: true });
  await expect(failure.page.locator('[data-retry="todo"]')).toBeVisible();
  await expect(failure.page.locator('[data-content="lessons"]')).toContainText(
    "サンプル生徒 A",
  );
  failure.recover();
  await failure.page.locator('[data-retry="todo"]').click();
  await ready(failure.page);
  await failure.page.evaluate(() =>
    dispatchEvent(
      new StorageEvent("storage", {
        key: "works_session_token",
        newValue: "other",
      }),
    ),
  );
  await expect(failure.page.locator("#home-auth-action")).toHaveAttribute(
    "aria-label",
    "Googleでログイン",
  );
  await expect(failure.page.locator("body")).not.toContainText(
    "サンプル生徒 A",
  );
  await failure.close();
  passed.push(
    "independent failure/retry and other-tab auth change clears data and shell",
  );
  const broken = await fixture({
    init: () => {
      Storage.prototype.getItem = function (k) {
        if (k.startsWith("works-home-dashboard")) return "{broken";
        return null;
      };
    },
  });
  await ready(broken.page);
  await expect(broken.page.locator("#dashboard-message")).toContainText(
    "初期配置",
  );
  await broken.close();
  passed.push("malformed layout recovers to defaults with visible warning");
  const midnight = await fixture();
  await ready(midnight.page);
  await midnight.page.clock.fastForward(3 * 3600000 + 100);
  await expect(midnight.page.locator("#dashboard-date")).toContainText(
    "10月30日",
  );
  await expect
    .poll(() =>
      midnight.requests.some((r) => r.url.includes("timeMin=2026-10-30")),
    )
    .toBe(true);
  await midnight.close();
  passed.push(
    "foreground midnight invalidates and reloads JST calendar window",
  );

  const interrupt = await fixture({ holdTodo: true });
  await expect(
    interrupt.page.locator('[data-content="lessons"]'),
  ).toContainText("サンプル生徒 A");
  const initial = interrupt.requests.filter(
    (r) => r.url === "/api/todo",
  ).length;
  await interrupt.page.locator("#dashboard-refresh").dblclick();
  assert.equal(
    interrupt.requests.filter((r) => r.url === "/api/todo").length,
    initial,
  );
  await interrupt.page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  await expect(interrupt.page.locator("#dashboard-widgets")).toBeEmpty();
  interrupt.release();
  await interrupt.page.evaluate(() =>
    dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })),
  );
  await ready(interrupt.page);
  await interrupt.close();
  passed.push(
    "repeated refresh coalesces; pagehide clears data and pageshow resumes safely",
  );
  const slow = await fixture({ holdTodo: true });
  await expect(slow.page.locator('[data-content="lessons"]')).toContainText(
    "サンプル生徒 A",
  );
  await slow.page.clock.fastForward(20050);
  await expect(slow.page.locator('[data-retry="todo"]')).toBeVisible();
  slow.release();
  await slow.page.locator('[data-retry="todo"]').click();
  await ready(slow.page);
  await slow.close();
  passed.push(
    "slow request times out independently and recovers via explicit retry",
  );
  const tokenWait = await fixture({
    init: () => {
      window.qaHoldGoogle = true;
    },
  });
  await expect(tokenWait.page.locator('[data-content="todo"]')).toContainText(
    "持ち越しの教材確認",
  );
  await tokenWait.page.waitForFunction(
    () => typeof window.qaReleaseGoogle === "function",
  );
  await tokenWait.page.clock.fastForward(20050);
  await expect(tokenWait.page.locator('[data-retry="lessons"]')).toBeVisible();
  await tokenWait.page.locator("#home-auth-action").click();
  await tokenWait.page.evaluate(() => window.qaReleaseGoogle());
  assert.equal(
    tokenWait.requests.filter((r) => r.url.includes("/calendar/v3/")).length,
    0,
  );
  await expect(tokenWait.page.locator("body")).not.toContainText(
    "サンプル生徒 A",
  );
  await tokenWait.close();
  passed.push(
    "unresolved Google-token wait times out; late token after logout causes no Calendar fetch",
  );
  const empty = await fixture({ empty: true });
  await expect(empty.page.locator('[data-content="todo"]')).toContainText(
    "今日までの未完了予定はありません",
  );
  await expect(empty.page.locator('[data-content="lessons"]')).toContainText(
    "今日の予定はありません",
  );
  await empty.page.locator("#dashboard-edit").click();
  while (await empty.page.locator("[data-hide]").count())
    await empty.page.locator("[data-hide]").first().click();
  await empty.page.locator("#dashboard-save").click();
  await expect(empty.page.locator("#dashboard-widgets")).toContainText(
    "ウィジェットは非表示",
  );
  await empty.page.reload();
  await expect(empty.page.locator("#dashboard-widgets")).toContainText(
    "ウィジェットは非表示",
  );
  await empty.page.locator("#dashboard-edit").click();
  empty.page.once("dialog", (d) => d.accept());
  await empty.page.locator("#dashboard-reset").click();
  await empty.page.locator("#dashboard-save").click();
  await expect(empty.page.locator(".dashboard-widget")).toHaveCount(3);
  await empty.close();
  passed.push(
    "genuine empty collections, all-hidden layout reload and confirmed initial-layout restore",
  );
  const large = await fixture({ large: true });
  await ready(large.page);
  await large.page.setViewportSize({ width: 390, height: 844 });
  const dueSection = large.page.locator('[data-content="todo"]');
  await expect(dueSection).toContainText("期限超過 8件（すべて表示）");
  for (let i = 1; i <= 7; i++)
    await expect(dueSection).toContainText(`期限超過追加 ${i}`);
  await expect(dueSection).toContainText("全13件");
  for (let i = 1; i <= 4; i++)
    await expect(dueSection).toContainText(`本日締切追加 ${i}`);
  await expect(dueSection).toContainText("3件表示");
  assert.equal(
    await large.page
      .locator(".dashboard-widget")
      .evaluateAll((es) =>
        es.some((e) =>
          ["auto", "scroll"].includes(getComputedStyle(e).overflowY),
        ),
      ),
    false,
  );
  await large.close();
  passed.push(
    "compact three-row summaries expose total counts and retain every overdue deadline without internal scrolling",
  );
  const touch = await fixture({ touch: true });
  await ready(touch.page);
  await touch.page.setViewportSize({ width: 390, height: 2400 });
  await touch.page.locator("#dashboard-edit").click();
  await touch.page.waitForFunction(() =>
    window.Sortable?.get(document.querySelector("#dashboard-widgets")),
  );
  const h = await touch.page
      .locator('[data-id="lessons"] .drag-handle')
      .boundingBox(),
    t = await touch.page.locator('[data-id="todo"]').boundingBox();
  const cdp = await touch.ctx.newCDPSession(touch.page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: h.x + 20, y: h.y + 20 }],
  });
  await touch.page.waitForTimeout(250);
  for (let i = 1; i <= 20; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: h.x + 20,
          y: h.y + 20 + ((t.y + t.height - 20 - h.y - 20) * i) / 20,
        },
      ],
    });
    await touch.page.waitForTimeout(20);
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(() =>
      touch.page.locator(".dashboard-widget").first().getAttribute("data-id"),
    )
    .not.toBe("lessons");
  await touch.page.locator("#dashboard-cancel").click();
  await touch.close();
  passed.push("emulated touch drag on dedicated handle changes draft order");
  const font = await fixture();
  await ready(font.page);
  const fontSession = await font.ctx.newCDPSession(font.page);
  await fontSession.send("DOM.enable");
  await fontSession.send("CSS.enable");
  const dom = await fontSession.send("DOM.getDocument");
  const node = await fontSession.send("DOM.querySelector", {
    nodeId: dom.root.nodeId,
    selector: ".dashboard-heading h2",
  });
  const used = await fontSession.send("CSS.getPlatformFontsForNode", {
    nodeId: node.nodeId,
  });
  const fontEvidence = {
    declaredStack: await font.page.evaluate(
      () => getComputedStyle(document.body).fontFamily,
    ),
    platformFonts: used.fonts,
    externalFontRequestsBlockedByFixture: true,
  };
  assert.ok(fontEvidence.declaredStack.includes("M PLUS 1p"));
  await fs.writeFile(
    path.join(artifacts, "font-evidence.json"),
    JSON.stringify(fontEvidence, null, 2),
  );
  console.log("Font evidence: " + JSON.stringify(fontEvidence));
  await font.close();
  await fs.writeFile(
    path.join(artifacts, "fullpage-capture-evidence.json"),
    JSON.stringify(fullPageEvidence, null, 2),
  );
  await fs.writeFile(
    path.join(artifacts, "results.json"),
    JSON.stringify({ passed }, null, 2),
  );
  console.log(JSON.stringify({ passed }, null, 2));
} finally {
  await browser.close();
}
