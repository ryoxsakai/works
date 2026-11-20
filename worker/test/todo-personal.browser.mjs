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
async function nav(page,id) {
  const item=page.locator('[data-view="'+id+'"]').first();
  if(!await item.isVisible()) await page.locator('#mobile-nav').click();
  await item.click();
}
async function openCapture(page) {
  const add = page.locator("#mobile-add");
  await (await add.isVisible() ? add : page.locator("#new-task")).click();
  await expect(page.locator("#quick-title")).toBeFocused();
}
async function showTasks(page) {
  if (await page.locator("#mobile-nav").isVisible() && await page.locator("#mobile-nav").getAttribute("aria-expanded")==="true")
    await page.locator("#mobile-nav").click();
}
async function openSection(page,selector) {
  if (selector === ".planner-filters") {
    await showTasks(page);
    if (!await page.locator("#display-panel").isVisible()) await page.locator("#display-button").click();
    return;
  }
  const row=page.locator(selector);
  if(!await row.locator('summary').first().isVisible()) await page.locator('#mobile-nav').click();
  if(!await row.evaluate(el=>el.open)) await row.locator('summary').first().click();
}
const rowMenu=(page,id)=>openSection(page,'[data-task="'+id+'"] .row-menu');
// Quick capture stays open for continuous entry; close it before other work.
async function closeCapture(page){
  if(await page.locator('#capture-sheet').evaluate(d=>d.open)) await page.keyboard.press('Escape');
  await expect(page.locator('#capture-sheet')).toBeHidden();
}
// Phones keep the sheet to one line; "＋" reveals day, memo and other settings.
async function showCaptureExtra(page){
  const more=page.locator('#capture-more');
  if(await more.isVisible() && await more.getAttribute('aria-expanded')!=='true') await more.click();
}
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
      await expect(page.locator("#today-label")).toHaveAttribute("title",new RegExp(base));
      const type = await page.evaluate(() => {
        const selectors = ["#today-label","#task-count","#display-button",".planner-row .task-name","#view-title",".works-header h1"];
        return selectors.map(selector => {
          const css = getComputedStyle(document.querySelector(selector));
          return [css.fontFamily.split(",")[0].replaceAll('"',""),css.fontWeight];
        });
      });
      // Every service shares the Works typeface (M PLUS 2); weights keep their hierarchy.
      assert.deepEqual(type.map(([family])=>family),Array(6).fill("M PLUS 2"));
      // DESIGN.md hierarchy: caption 400, labels/buttons/task names 600, page title 700.
      assert.deepEqual(type.slice(0,5).map(([,weight])=>weight),["400","600","600","600","700"]);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),"light");
      await expect(page.locator('.works-header .works-quick-add')).toBeVisible();
      await expect(page.locator('.works-header .btn, .works-settings-dialog')).toHaveCount(0);
      const taskBounds = await page.locator("#tasks .task-card").nth(2).boundingBox();
      assert.ok(taskBounds.y + taskBounds.height < 844, "first three tasks fit before scrolling");
      if (width <= 390) {
        assert.ok(taskBounds.x < 2 && taskBounds.width >= width-2, "edge-to-edge mobile rows");
        await expect(page.locator("#mobile-add")).toBeVisible();
      }
      await openCapture(page);
      await expect(page.locator('#capture-submit')).toBeDisabled();
      await expect(page.locator('#capture-details')).not.toHaveAttribute('open');
      await expect(page.locator('#capture-submit')).toHaveClass(/btn-solid/);
      assert.equal(await page.locator('#capture-submit').evaluate(el=>getComputedStyle(el).whiteSpace),'nowrap');
      assert.ok((await page.locator('#capture-submit').boundingBox()).height<=56,'capture action stays one line');
      await page.keyboard.press("Escape");
      await expect(page.locator("#capture-sheet")).toBeHidden();
      const beforePresentation=JSON.stringify(await db()), beforePosts=postCount;
      await page.evaluate(async()=>{
        const {startTodoPresentation}=await import('/shared/ui/todo-presentation.mjs?v=2');
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
      assert.ok(parseFloat(inputStyle.font) >= 16, "task title stays legible without iOS zoom");
      assert.equal(
        inputStyle.color,
        await page.locator("html").evaluate(el=>getComputedStyle(el).getPropertyValue("--fg").trim()).then(value=>{const c=value.match(/\w\w/g).slice(0,3).map(x=>parseInt(x,16));return `rgb(${c.join(", ")})`;}),
      );
      await openSection(page,".planner-filters");
      await page.locator("#task-search").fill("no such teacher task");
      await expect(page.locator("#tasks")).toContainText("条件に合うタスクがありません");
      await expect(page.locator("#deadlines")).toContainText("today4");
      await page.locator("#clear-filters").click();
      await expect(page.locator("#task-search")).toBeFocused();
      await expect(page.locator("#task-count")).toHaveText("未完了 5件");
      await expect(page.locator("#view-title")).toHaveText("今日のタスク");
      await expect(page.locator(".task-card")).toHaveCount(5);
      await nav(page,"all");
      await rowMenu(page,"today0");
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
  await nav(page,"all");
  await openSection(page,".planner-filters");
  await page.locator("#category-filter").selectOption("スクールサポート");
  await openSection(page,".planner-settings");
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
  await showTasks(page);
  await page.locator("#task-search").fill("not visible capture context");
  await openCapture(page);
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
  await showCaptureExtra(page);
  await page.locator("#capture-memo").fill("確認用のメモ");
  await page.locator("#capture-submit").click();
  await expect(page.locator("#notice")).toContainText("インボックス");
  await expect(page.locator("#capture-added")).toContainText("インボックスに追加しました");
  await expect(page.locator("#quick-title")).toHaveValue("");
  await closeCapture(page);
  assert.equal((await db()).tasks.at(-1).memo, "確認用のメモ");
  assert.equal((await db()).tasks.at(-1).plannedDay, null);
  await expect(page.locator("#task-search")).toHaveValue("");
  await nav(page,"upcoming");
  await page.locator('[data-add-day="2026-10-28"]').click();
  await expect(page.locator("#capture-day")).toHaveValue("2026-10-28");
  await page.locator("#quick-title").fill("明日の保護者面談資料を準備");
  await page.locator("#quick-title").press("Enter");
  await expect(page.locator("#notice")).toContainText("2026-10-28");
  await closeCapture(page);
  assert.equal((await db()).tasks.at(-1).plannedDay, "2026-10-28");
  assert.equal((await db()).tasks.at(-1).deadline, null);
  const newId = (await db()).tasks.at(-1).id;
  await nav(page,"all");
  await rowMenu(page,newId);
  await page.locator(`[data-task="${newId}"] [data-action="plan-today"]`).click();
  await expect(page.locator("#notice")).toContainText("締切は変更していません");
  assert.equal((await db()).tasks.at(-1).plannedDay, base);
  assert.equal((await db()).tasks.at(-1).deadline, null);
  await expect(page.locator(`[data-task="${newId}"] [data-action="detail"]`)).toBeFocused();


  await page
    .getByRole("button", { name: "詳細：合成 today4", exact: true })
    .click();
  await expect(page.locator("#summary-name")).toHaveText("合成 today4");
  await expect(page.locator("#summary-settings")).not.toHaveAttribute("open");
  await page.locator("#summary-complete").click();
  await expect(page.locator("#detail")).toBeHidden();
  assert.equal((await db()).tasks.find(t => t.id === "today4").status, "done");
  await page.getByRole("button", {name:"元に戻す",exact:true}).click();
  await expect.poll(async () => (await db()).tasks.find(t => t.id === "today4").status).toBe("pending");
  await page.getByRole("button", {name:"詳細：合成 today4",exact:true}).click();
  await page.locator("#summary-day").click();
  await expect(page.locator("[name=plannedDay]")).toBeFocused();
  await page.locator('#detail-form [data-offset="1"]').click();
  await expect(page.locator("[name=plannedDay]")).toHaveValue("2026-10-28");
  await page.locator("[name=plannedDay]").fill("2026-11-15");
  await page.locator("#detail-form button[type=submit]").click();
  await expect(page.locator("#task-summary")).toBeVisible();
  await page.locator("#task-summary [data-close]").click();
  await expect(page.locator("#detail")).toBeHidden();
  assert.equal(
    (await db()).tasks.find((t) => t.id === "today4").deadline,
    "2026-10-26",
  );
  await openSection(page,".planner-settings");
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
  await showTasks(page);
  await page
    .getByRole("button", { name: "詳細：合成 today0", exact: true })
    .click();
  await page.locator("#summary-edit").click();
  await page.getByText("分類・優先度",{exact:true}).click();
  await page.locator("[name=roleId]").selectOption("lessons");
  await page.locator("#detail-form button[type=submit]").click();
  await expect(page.locator("#task-summary")).toBeVisible();
  await page.locator("#task-summary [data-close]").click();
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
  await rowMenu(page,"done");
  await fast.click();
  await expect(page.locator("[data-task=done] [data-action=clone]").first()).toBeDisabled();
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
  await rowMenu(page,"done");
  await fast.click();
  await expect.poll(async () => (await db()).tasks.length).toBe(count + 2);
  await expect(page.locator("#quick-title")).toBeEnabled();
  loss = true;
  await rowMenu(page,"inbox");
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
  await nav(page,"all");
  await rowMenu(page,"future");
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
  await page.locator("#summary-edit").click();
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
  await expect(page.locator("#task-summary")).toBeVisible();
  await page.locator("#task-summary [data-close]").click();
  await expect(page.locator("#detail")).toBeHidden();
  assert.equal(
    (await db()).tasks.find((t) => t.id === "inbox").memo,
    "別クライアントの説明",
  );
  // Category indexes cannot be reused after concurrent reorder.
  await openSection(page,".planner-settings");
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
  await rowMenu(page,"inbox");
  failNextList = true;
  await page
    .locator('[data-task=inbox] [data-action=clone][data-days="3"]')
    .click();
  await expect(page.locator("#notice")).toContainText("複製は保存済み");
  await expect(page.locator("[data-retry]")).toHaveCount(1);
  const outstanding = await page
    .locator("[data-retry]")
    .getAttribute("data-retry");
  await nav(second,"all");
  await rowMenu(second,"future");
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
  await nav(page,"all");
  await rowMenu(page,"inbox");
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
  await verifyPlanner(page,db,origin,nav,rowMenu);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  await mf.dispose();
}

async function verifyPlanner(page,db,origin,nav,rowMenu) {
  await openCapture(page);
  await page.locator("#quick-title").fill("毎週水曜 12:15 配布資料 #代官山/冬期講習 @準備 @印刷 p1");
  await page.locator("#quick-title").press("Enter");
  await expect(page.locator("#capture-added")).toContainText("代官山 / 冬期講習");
  await page.locator("#capture-jump").click();
  await expect(page.locator("#capture-sheet")).toBeHidden();
  await expect(page.locator("#view-title")).toHaveText("代官山 / 冬期講習");
  const first=(await db()).tasks.at(-1);
  assert.equal(first.plan.labels.length,2);
  assert.equal(first.plan.priority,1);
  await page.locator("#edit-view").click();
  await page.locator('[data-color="green"]').click();
  await page.locator("#organizer-form button[type=submit]").click();
  await expect(page.locator("#organizer")).toBeHidden();
  assert.equal((await db()).planner.projects.find(i=>i.id===first.plan.project).color,"green");
  await openCapture(page);
  await page.locator("#quick-title").fill("板書案");
  await page.locator("#quick-title").press("Enter");
  await expect(page.locator("#tasks .planner-row")).toHaveCount(2);
  await closeCapture(page);
  const secondTask=(await db()).tasks.at(-1);
  await rowMenu(page,secondTask.id);
  await page.locator('[data-task="'+secondTask.id+'"] [data-action=up]').click();
  await expect(page.locator("#tasks .task-name").first()).toHaveText("板書案");
  await openSection(page,".planner-filters");
  await page.locator("#task-sort").selectOption("priority");
  await expect(page.locator("#tasks .task-name").first()).toHaveText("配布資料");
  const labelId=first.plan.labels[0];
  await page.locator('[data-task="'+first.id+'"] [data-label="'+labelId+'"]').click();
  await expect(page.locator("#view-title")).toHaveText("準備");
  await page.locator("#edit-view").click();
  await page.locator('[data-color="orange"]').click();
  await page.locator("#organizer-form button[type=submit]").click();
  await expect(page.locator("#organizer")).toBeHidden();
  assert.equal((await db()).planner.labels.find(i=>i.id===labelId).color,"orange");
  await page.locator("#new-filter").click();
  await page.locator("#organizer-name").fill("準備中の教材");
  await page.locator("#filter-label").selectOption(labelId);
  await page.locator("#organizer-form button[type=submit]").click();
  await expect(page.locator("#organizer")).toBeHidden();
  await page.locator("#saved-filters button").click();
  await expect(page.locator("#tasks .task-name")).toHaveText("配布資料");
  await nav(page,"review");
  for(const label of ["次の項目へ","次の項目へ","レビューを完了"]){
    await page.getByRole("button",{name:label,exact:true}).click();
    await expect(page.locator("#advance-review")).toBeEnabled();
  }
  await expect.poll(async()=>(await db()).planner.review.last).toBeTruthy();
  await page.goto(origin+"/todo/#"+new URLSearchParams({kind:"student",name:"合成生徒",group:"試験用"}));
  await page.reload();
  await expect(page.locator("#capture-source")).toContainText("合成生徒");
  await page.locator("#quick-title").fill("面談資料を用意");
  await page.locator("#quick-title").press("Enter");
  await expect(page.locator("#capture-source")).toBeEmpty();
  await closeCapture(page);
  assert.equal((await db()).tasks.at(-1).plan.source.name,"合成生徒");
  const parent=(await db()).tasks.at(-1);
  await page.locator('[data-task="'+parent.id+'"] [data-action=detail]').click();
  await page.getByText("説明・サブタスク",{exact:true}).click();
  await page.locator("#add-child").click();
  await page.locator("#quick-title").fill("合成サブタスク");
  await page.locator("#quick-title").press("Enter");
  await closeCapture(page);
  await expect(page.locator("#tasks .task-name").filter({hasText:"合成サブタスク"})).toBeVisible();
  assert.equal((await db()).tasks.at(-1).plan.parent,parent.id);
  await nav(page,"upcoming");
  const nextWeek = page.locator('[data-week="7"]');
  await nextWeek.click();
  const dayButton = page.locator("[data-add-day]").first();
  const planned = await dayButton.getAttribute("data-add-day");
  await dayButton.click();
  await expect(page.locator("#capture-day")).toHaveValue(planned);
  await page.locator("#quick-title").fill("16:00 教材を確認");
  await showCaptureExtra(page);
  await page.locator("#capture-details summary").click();
  await page.locator("#capture-project").selectOption(first.plan.project);
  await page.locator("#capture-reminder").fill(planned+"T15:30");
  await page.locator("#capture-deadline").fill("2026-12-11");
  await page.locator("#capture-tags").fill("教材作成 印刷");
  await page.locator("#capture button[type=submit]").click();
  await expect(page.locator("#capture-added")).toBeVisible();
  await closeCapture(page);
  const scheduled = (await db()).tasks.at(-1);
  assert.equal(scheduled.plannedDay,planned);
  assert.equal(scheduled.plan.time,"16:00");
  assert.equal(scheduled.plan.project,first.plan.project);
  assert.equal(scheduled.plan.labels.length,2);
  assert.equal(scheduled.plan.reminder,planned+"T15:30");
  assert.equal(scheduled.deadline,"2026-12-11");
  await page.keyboard.press("q");
  await expect(page.locator("#quick-title")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#capture-sheet")).toBeHidden();
  const lesson = new URLSearchParams({kind:"lesson", name:"合成読解講座", day:planned, event:"test-event", calendar:"test-calendar"});
  await page.goto(origin+"/todo/#"+lesson);
  await page.reload();
  await expect(page.locator("#capture-source")).toContainText("合成読解講座");
  await page.locator("#quick-title").fill("授業後の復習資料");
  await page.locator("#capture button[type=submit]").click();
  await expect(page.locator("#capture-added")).toBeVisible();
  await closeCapture(page);
  const linked = (await db()).tasks.at(-1);
  assert.equal(linked.plan.source.event,"test-event");
  await page.locator('[data-task="'+linked.id+'"] .task-name').click();
  const lessonLink = new URL(await page.locator("#origin-link a").getAttribute("href"),origin);
  assert.equal(lessonLink.searchParams.get("record_date"),planned);
  assert.equal(lessonLink.searchParams.get("todo_event"),"test-event");
  assert.equal(lessonLink.searchParams.get("todo_calendar"),"test-calendar");
  console.log("PASS nested projects, colors, labels, sorting, saved filters, review, linked student and lesson capture, week navigation and scheduled capture with a reminder");
}
