import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";
const artifacts = fileURLToPath(
  new URL("../test-artifacts/todo-personal", import.meta.url),
);
await mkdir(artifacts, { recursive: true });
const mf = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    compatibilityDate: "2026-08-01",
    d1Databases: { DB: "todo-ui" },
  }),
  DB = await mf.getD1Database("DB");
await DB.prepare(
  "CREATE TABLE todo_state (id INTEGER PRIMARY KEY, data TEXT NOT NULL, revision INTEGER NOT NULL)",
).run();
const base = "2026-10-27",
  roles = [
    {
      id: "students",
      name: "生徒管理",
      icon: "👥",
      color: "green",
      archived: false,
    },
    {
      id: "lessons",
      name: "授業管理",
      icon: "📚",
      color: "blue",
      archived: false,
    },
  ];
const task = (id, extra = {}) => ({
  id,
  name: "合成 " + id,
  category: "スクールサポート",
  priority: null,
  deadline: null,
  progress: 0,
  memo: "元だけのメモ",
  createdAt: base,
  status: "pending",
  ...extra,
});
await DB.prepare("INSERT INTO todo_state VALUES(1,?,1)")
  .bind(
    JSON.stringify({
      tasks: [
        ...Array.from({ length: 5 }, (_, i) =>
          task("today" + i, {
            plannedDay: base,
            roleId: "students",
            deadline: i === 4 ? "2026-10-26" : null,
          }),
        ),
        task("future", { plannedDay: "2026-10-28", roleId: "lessons" }),
        task("inbox"),
        task("done", {
          status: "done",
          progress: 100,
          completedAt: "2026-10-20",
          checklist: [{ id: "step1", text: "見直し", checked: true }],
          reusableDescription: "引き継ぐ説明",
        }),
      ],
      categories: ["スクールサポート", "仕事", "個人", "その他"],
      roles,
    }),
  )
  .run();
const env = {
  DB,
  SESSION_SECRET: "synthetic-browser-secret",
  ALLOWED_EMAIL: "owner@example.test",
  ALLOWED_ORIGIN: "http://localhost",
};
const payload = Buffer.from(
    JSON.stringify({ email: env.ALLOWED_EMAIL, exp: Date.now() + 3600000 }),
  ).toString("base64url"),
  key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  ),
  token =
    payload +
    "." +
    Buffer.from(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ).toString("base64url");
let loss = false,
  hold = null,
  postCount = 0,
  failNextList = false;
const root = fileURLToPath(new URL("../..", import.meta.url)).replace(
    /\/$/,
    "",
  ),
  db = async () =>
    JSON.parse((await DB.prepare("SELECT data FROM todo_state").first()).data);
async function externalEdit(change) {
  const row = await DB.prepare("SELECT data,revision FROM todo_state").first();
  const next = JSON.parse(row.data);
  change(next);
  const result = await DB.prepare(
    "UPDATE todo_state SET data=?,revision=revision+1 WHERE revision=?",
  )
    .bind(JSON.stringify(next), row.revision)
    .run();
  assert.equal(result.meta.changes, 1);
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/shared/auth.js") {
      res.setHeader("Content-Type", "text/javascript");
      return res.end(
        `export function watchAuth(o){o.onSignedIn()} export function getSessionToken(){return ${JSON.stringify(token)}} export function signIn(){} export async function signOutUser(){}`,
      );
    }
    if (url.pathname === "/api/todo" && req.method === "GET" && failNextList) {
      failNextList = false;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "synthetic list read failure" }));
      return;
    }
    if (url.pathname.startsWith("/api/todo")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const response = await worker.fetch(
        new Request(url, {
          method: req.method,
          headers: req.headers,
          body: body || undefined,
        }),
        env,
      );
      if (req.method === "POST" && url.pathname.endsWith("/clone")) {
        postCount++;
        if (hold) await hold;
        if (loss) {
          req.socket.destroy();
          return;
        }
      }
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(await response.text());
      return;
    }
    const path = resolve(
      root,
      "." + url.pathname + (url.pathname.endsWith("/") ? "index.html" : ""),
    );
    if (!path.startsWith(root + "/")) throw Error("invalid path");
    res.setHeader(
      "Content-Type",
      { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript" }[
        extname(path)
      ] || "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch (e) {
    res.writeHead(500);
    res.end(e.message);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  ...((process.env.CHROMIUM_PATH || process.env.BROWSER_EXECUTABLE) ? {executablePath:process.env.CHROMIUM_PATH || process.env.BROWSER_EXECUTABLE} : {}),
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const width of [320, 390, 1440])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
          viewport: { width, height: 900 },
          timezoneId: "America/Los_Angeles",
          colorScheme: theme,
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.clock.install({ time: new Date("2026-10-26T15:30:00Z") });
      await page.addInitScript(
        (theme) => localStorage.setItem("works_theme", theme),
        theme,
      );
      await page.goto(origin + "/todo/");
      await expect(page.locator("#app")).toBeVisible();
      await expect(page.locator("#today-label")).toContainText(base);
      await expect(page.locator('#capture button')).toHaveClass(/btn-solid/);
      assert.equal(await page.locator('#capture button').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
      assert.ok((await page.locator('#capture button').boundingBox()).height<=56,'capture action stays one line');
      const beforePresentation=JSON.stringify(await db()), beforePosts=postCount;
      await page.evaluate(async()=>{
        const {startTodoPresentation}=await import('/shared/ui/todo-presentation.mjs');
        const c=startTodoPresentation(); c.start();
        window.dispatchEvent(new Event('pagehide'));
        const b=document.createElement('button'); b.type='button'; b.id='ui-probe'; b.textContent='test';
        document.querySelector('#app').append(b);
      });
      assert.equal(await page.locator('#ui-probe').getAttribute('class'),null);
      await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));
      await expect(page.locator('#ui-probe')).toHaveClass(/btn/);
      await page.evaluate(()=>document.querySelector('#ui-probe').remove());
      assert.equal(postCount,beforePosts);
      assert.equal(JSON.stringify(await db()),beforePresentation);
      await page.emulateMedia({reducedMotion:'reduce'});
      assert.equal(await page.locator('#quick-title').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
      await page.emulateMedia({reducedMotion:'no-preference'});
      const inputStyle = await page.locator("#quick-title").evaluate((e) => ({
        color: getComputedStyle(e).color,
        font: getComputedStyle(e).fontSize,
      }));
      assert.equal(inputStyle.font, "16px");
      assert.equal(
        inputStyle.color,
        theme === "dark" ? "rgb(231, 237, 246)" : "rgb(36, 51, 71)",
      );
      await page.locator("#task-search").fill("no such teacher task");
      await expect(page.locator("#tasks")).toContainText("条件に合うタスクがありません");
      await expect(page.locator("#deadlines")).toContainText("today4");
      await page.locator("#clear-filters").click();
      await expect(page.locator("#task-search")).toBeFocused();
      await expect(page.locator("#task-count")).toContainText("全8件");
      const groups = page.locator(".group");
      await expect(
        groups
          .filter({
            has: page.getByRole("heading", {
              name: "今日のフォーカス",
              exact: true,
            }),
          })
          .locator(".task-card"),
      ).toHaveCount(3);
      await expect(
        groups
          .filter({
            has: page.getByRole("heading", {
              name: "今日・持ち越しの残り",
              exact: true,
            }),
          })
          .locator(".task-card"),
      ).toHaveCount(2);
      const cardHeight = await page.locator('[data-task="today0"]').evaluate(e => e.getBoundingClientRect().height);
      assert.ok(cardHeight < 330, `compact card ${width}/${theme}: ${cardHeight}`);
      for (const n of [1,3,7,14]) await expect(page.locator(`[data-task="today0"] [data-days="${n}"]`)).toBeVisible();
      await page.locator("#role-filter").selectOption("lessons");
      await expect(page.locator("#deadlines")).toContainText("today4");
      await page.locator("#role-filter").selectOption("");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `overflow ${width}/${theme}`,
      );
      await page.locator("#board-view").click();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        "board overflow",
      );
      assert.equal(
        await page.locator(".task-card").count(),
        (await db()).tasks.length,
      );
      await page.screenshot({
        path: `${artifacts}/${width}-${theme}-board.png`,
        fullPage: true,
      });
      await page.locator("#list-view").click();
      const detail = page.getByRole("button", {
        name: "詳細：合成 today0",
        exact: true,
      });
      await detail.click();
      await page.screenshot({
        path: `${artifacts}/${width}-${theme}-detail.png`,
      });
      await page.keyboard.press("Shift+Tab");
      assert.equal(
        await page.evaluate(() =>
          document.querySelector("#detail").contains(document.activeElement),
        ),
        true,
      );
      await page.keyboard.press("Escape");
      await expect(page.locator("#detail")).toBeHidden();
      await expect(detail).toBeFocused();
      await detail.click();
      await page.goBack();
      await expect(page.locator("#detail")).toBeHidden();
      await page.evaluate(() => scrollTo(0,0));
      await page.screenshot({
        path: `${artifacts}/${width}-${theme}.png`,
        fullPage: true,
      });
      await page.emulateMedia({media:'print'});
      await expect(page.locator('.task-card')).toHaveCount(8);
      await page.pdf({path:`${artifacts}/${width}-${theme}-print.pdf`,format:'A4'});
      await page.emulateMedia({media:'screen'});
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px/${theme}: JST, layout, focus count, deadlines, same-data board, modal focus/Escape/back`,
      );
      await context.close();
    }
  const interactionContext = await browser.newContext({
    viewport: { width: 390, height: 900 },
  });
  const page = await interactionContext.newPage();
  await page.clock.install({ time: new Date("2026-10-26T15:30:00Z") });
  await page.goto(origin + "/todo/");
  await expect(page.locator("#app")).toBeVisible();
  await page.locator("#category-filter").selectOption("スクールサポート");
  await page.locator("#categories-open").click();
  await page.locator("#categories-form [name=name]").fill("合成カテゴリ");
  await page.locator("#categories-form button").click();
  await expect
    .poll(async () => (await db()).categories.includes("合成カテゴリ"))
    .toBe(true);
  const legacyCategory = page.locator('[data-category-index="0"]');
  await legacyCategory.locator("input").fill("支援業務");
  await legacyCategory.locator("[data-category-action=rename]").click();
  await expect
    .poll(
      async () => (await db()).tasks.find((t) => t.id === "today0").category,
    )
    .toBe("支援業務");
  assert.equal(
    (await db()).tasks.find((t) => t.id === "today0").roleId,
    "students",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#category-filter")).toHaveValue("");
  assert.equal(
    await page.locator(".task-card").count(),
    (await db()).tasks.length,
    "active renamed category normalizes filter and visible list together",
  );
  await page.locator("#task-search").fill("not visible capture context");
  await page.locator("#quick-title").fill("日本語の確定中");
  const beforeIme = (await db()).tasks.length;
  for (const fields of [{isComposing:true}, {keyCode:229}]) {
    const cancelled = await page.locator("#quick-title").evaluate((input, fields) => {
      const event = new KeyboardEvent("keydown", {key:"Enter",code:"Enter",bubbles:true,cancelable:true,...fields});
      return !input.dispatchEvent(event) && event.defaultPrevented;
    }, fields);
    assert.equal(cancelled, true, "composition Enter must cancel implicit submit");
  }
  assert.equal((await db()).tasks.length, beforeIme);
  await page.locator("#quick-title").fill("タイトルだけ");
  await page.locator("#capture button").click();
  await expect(page.locator("#notice")).toContainText("インボックス");
  assert.equal((await db()).tasks.at(-1).plannedDay, null);
  await expect(page.locator("#task-search")).toHaveValue("");
  await page.locator("#capture-day").selectOption("1");
  await page.locator("#quick-title").fill("明日の保護者面談資料を準備");
  await page.locator("#quick-title").press("Enter");
  await expect(page.locator("#notice")).toContainText("2026-10-28");
  assert.equal((await db()).tasks.at(-1).plannedDay, "2026-10-28");
  assert.equal((await db()).tasks.at(-1).deadline, null);
  const newId = (await db()).tasks.at(-1).id;
  await page.locator(`[data-task="${newId}"] [data-action="plan-today"]`).click();
  await expect(page.locator("#notice")).toContainText("締切は変更していません");
  assert.equal((await db()).tasks.at(-1).plannedDay, base);
  assert.equal((await db()).tasks.at(-1).deadline, null);
  await expect(page.locator(`[data-task="${newId}"] [data-action="detail"]`)).toBeFocused();
  await page.locator("#capture-day").selectOption("");

  await page
    .getByRole("button", { name: "詳細：合成 today4", exact: true })
    .click();
  await page.locator("[name=plannedDay]").fill("2026-11-15");
  await page.locator("#detail-form button[type=submit]").click();
  await expect(page.locator("#detail")).toBeHidden();
  assert.equal(
    (await db()).tasks.find((t) => t.id === "today4").deadline,
    "2026-10-26",
  );
  await page.locator("#roles-open").click();
  await page.locator("[data-role=students] [data-archive]").click();
  await expect(page.locator("[data-role=students] [data-archive]")).toHaveText(
    "再開",
  );
  assert.equal(
    (await db()).tasks.find((t) => t.id === "today0").roleId,
    "students",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "詳細：合成 today0", exact: true })
    .click();
  await page.locator("[name=roleId]").selectOption("lessons");
  await page.locator("#detail-form button[type=submit]").click();
  await expect(page.locator("#detail")).toBeHidden();
  assert.equal(
    (await db()).tasks.find((t) => t.id === "today0").roleId,
    "lessons",
  );
  let release;
  hold = new Promise((r) => (release = r));
  const count = (await db()).tasks.length,
    original = (await db()).tasks.find((t) => t.id === "done");
  const fast = page
    .locator("[data-task=done]")
    .getByRole("button", { name: "1週間後に複製：合成 done", exact: true });
  await fast.click();
  await expect(fast).toBeDisabled();
  await expect.poll(() => postCount).toBe(1);
  assert.equal((await db()).tasks.length, count + 1);
  release();
  hold = null;
  await expect(page.locator("#notice")).toContainText("2026-11-03 に複製");
  let clone = (await db()).tasks.at(-1);
  assert.equal(clone.status, "pending");
  assert.equal(clone.checklist[0].checked, false);
  assert.equal(clone.deadline, null);
  assert.deepEqual(
    (await db()).tasks.find((t) => t.id === "done"),
    original,
  );
  await fast.click();
  await expect.poll(async () => (await db()).tasks.length).toBe(count + 2);
  await expect(page.locator("#quick-title")).toBeEnabled();
  loss = true;
  await page
    .getByRole("button", { name: "3日後に複製：合成 inbox", exact: true })
    .click();
  await expect(page.locator("#notice")).toContainText("結果を確認できません");
  const afterLoss = postCount;
  loss = false;
  await page.reload();
  await expect(page.locator("#recovery")).toContainText("結果確認");
  await page.locator("[data-retry]").click();
  await expect(page.locator("#recovery")).toBeEmpty();
  assert.equal(postCount, afterLoss);
  await page.locator("[data-task=future] [data-action=custom-clone]").click();
  await page.locator("[name=amount]").fill("2");
  await page.locator("[name=unit]").selectOption("7");
  await expect(page.locator("#clone-target")).toContainText("2026-11-10");
  await page.locator("#clone-form [name=deadline]").fill("2026-11-12");
  await expect(page.locator("#deadline-preview")).toContainText("2026-11-12");
  hold = new Promise((r) => (release = r));
  await page.locator("#clone-form button[type=submit]").click();
  await expect(page.locator("#clone-form button[type=submit]")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator("#clone-dialog")).toBeHidden();
  release();
  hold = null;
  await expect(page.locator("#quick-title")).toBeEnabled();
  assert.equal((await db()).tasks.at(-1).deadline, "2026-11-12");
  assert.equal((await db()).tasks.at(-1).plannedDay, "2026-11-10");
  await page
    .locator("[data-task=future]")
    .getByRole("button", { name: "詳細：合成 future", exact: true })
    .click();
  await expect(page.locator("#detail")).toBeVisible();
  await page.keyboard.press("Escape");
  // A failed CAS must never turn a stale form into a fresh overwrite.
  await page.locator("[data-task=inbox] [data-action=detail]").click();
  await page.locator("#detail-form [name=name]").fill("古いフォームの編集");
  await externalEdit((s) => {
    const task = s.tasks.find((t) => t.id === "inbox");
    task.deadline = "2026-12-01";
    task.memo = "別クライアントの説明";
  });
  await page.locator("#detail-form button[type=submit]").click();
  await expect(page.locator("#detail [data-dialog-conflict]")).toBeVisible();
  await expect(page.locator("#detail-form button[type=submit]")).toBeDisabled();
  await page.locator("#detail-form").evaluate((f) => f.requestSubmit());
  await expect(page.locator("#detail [data-dialog-reload]")).toBeEnabled();
  assert.equal(
    (await db()).tasks.find((t) => t.id === "inbox").deadline,
    "2026-12-01",
  );
  assert.equal(
    (await db()).tasks.find((t) => t.id === "inbox").memo,
    "別クライアントの説明",
  );
  await page.locator("#detail [data-dialog-reload]").click();
  await expect(page.locator("#detail-form [name=deadline]")).toHaveValue(
    "2026-12-01",
  );
  await expect(page.locator("#detail-form button[type=submit]")).toBeEnabled();
  await page.locator("#detail-form button[type=submit]").click();
  await expect(page.locator("#detail")).toBeHidden();
  assert.equal(
    (await db()).tasks.find((t) => t.id === "inbox").memo,
    "別クライアントの説明",
  );
  // Category indexes cannot be reused after concurrent reorder.
  await page.locator("#categories-open").click();
  await page
    .locator('[data-category-index="0"] input')
    .fill("間違って適用してはいけない名前");
  await externalEdit((s) => s.categories.reverse());
  const reordered = (await db()).categories;
  await page
    .locator('[data-category-index="0"] [data-category-action=rename]')
    .click();
  await expect(
    page.locator("#categories-dialog [data-dialog-conflict]"),
  ).toBeVisible();
  await expect(
    page.locator('[data-category-index="0"] [data-category-action=rename]'),
  ).toBeDisabled();
  assert.deepEqual((await db()).categories, reordered);
  await page.locator("#categories-dialog [data-dialog-reload]").click();
  await expect(page.locator('[data-category-index="0"] input')).toHaveValue(
    reordered[0],
  );
  await page.keyboard.press("Escape");
  // A different tab cannot erase a committed-but-not-refreshed operation.
  const second = await page.context().newPage();
  await second.clock.install({ time: new Date("2026-10-26T15:30:00Z") });
  await second.goto(origin + "/todo/");
  await expect(second.locator("#app")).toBeVisible();
  failNextList = true;
  await page
    .locator('[data-task=inbox] [data-action=clone][data-days="3"]')
    .click();
  await expect(page.locator("#notice")).toContainText("複製は保存済み");
  await expect(page.locator("[data-retry]")).toHaveCount(1);
  const outstanding = await page
    .locator("[data-retry]")
    .getAttribute("data-retry");
  await second
    .locator('[data-task=future] [data-action=clone][data-days="1"]')
    .click();
  await expect(second.locator("#notice")).toContainText("に複製しました");
  assert.equal(
    await second.evaluate(
      (key) => Object.keys(localStorage).filter((k) => k.endsWith(key)).length,
      outstanding,
    ),
    1,
  );
  const beforeRecovery = postCount;
  await page.clock.setSystemTime(new Date("2026-10-27T15:00:01Z"));
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#recovery")).toContainText("2026-10-30");
  await page.locator(`[data-retry="${outstanding}"]`).click();
  await expect(page.locator("#recovery")).toBeEmpty();
  assert.equal(
    postCount,
    beforeRecovery,
    "receipt recovery across reload/midnight does not clone again",
  );
  await second.close();
  console.log(
    "PASS independent-review regressions: stale detail/CAS, stale category indexes, active-category filter, reload failure recovery, cross-tab isolation, midnight frozen retry",
  );
  await page.clock.setSystemTime(new Date("2026-10-27T15:00:01Z"));
  await page
    .locator('[data-task=inbox] [data-action=clone][data-days="1"]')
    .click();
  await expect(page.locator("#notice")).toContainText(
    "2026-10-29 に複製しました",
  );
  assert.equal((await db()).tasks.at(-1).plannedDay, "2026-10-29");
  console.log("PASS fast clone uses operation Tokyo today after midnight");
  // A separate synthetic teaching-day walkthrough; no live services or user data.
  const audit = await db();
  const names = ["面談記録を整理する", "高3英語の授業プリントを確認", "模試の解説を見直す", "保護者への連絡内容を下書き", "提出期限のある答案を採点", "明日の板書案を準備", "次回面談の論点をメモ", "授業の振り返りを記録"];
  audit.tasks = audit.tasks.slice(0,8).map((t,i) => ({...t,name:names[i]}));
  await DB.prepare("UPDATE todo_state SET data=?, revision=revision+1 WHERE id=1").bind(JSON.stringify(audit)).run();
  await page.reload();
  await expect(page.locator("#app")).toBeVisible();
  await page.evaluate(() => scrollTo(0,0));
  const deadlineHeight = await page.locator(".deadline-row").first().evaluate(e => e.getBoundingClientRect().height);
  assert.ok(deadlineHeight < 150, `long teacher deadline readable: ${deadlineHeight}`);
  await page.screenshot({path:`${artifacts}/teacher-day-mobile.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:`${artifacts}/teacher-day-desktop.png`,fullPage:true});

  console.log(
    "PASS capture, category add/rename preserving task links, reschedule/deadline distinction, role archive/reassignment, pending disabled, repeated independent clones, completion preservation/checklist reset, lost-response reload recovery, custom week/deadline, delayed dismissal",
  );
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await mf.dispose();
}
