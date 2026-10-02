// Synthetic HTTPS origins only. Every request is fulfilled from local fixtures;
// no real API key, user login, live service, TLS exception, or deployment is used.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { Miniflare } from "miniflare";
import worker from "../src/index.js";

const ORIGIN = "https://works-auth.test";
const CALLBACK = "https://works-client.test/callback";
const SESSION = "__Host-works_mcp_session";
const KEY = "synthetic-browser-test-only";
const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('fixture'); } };", compatibilityDate: "2026-08-01", d1Databases: { DB: "browser-only" } });
let browser;
try {
  const DB = await mf.getD1Database("DB");
  const env = { DB, WORKS_API_KEY: KEY, SESSION_SECRET: "synthetic-signing-key-only", ALLOWED_EMAIL: "test@example.test", ALLOWED_ORIGIN: ORIGIN };
  const response = await worker.fetch(new Request(ORIGIN + "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) }), env);
  const { client_id } = await response.json();
  const params = new URLSearchParams({ response_type: "code", client_id, redirect_uri: CALLBACK, code_challenge: "a".repeat(43), code_challenge_method: "S256", scope: "schedule:read", state: "browser-fixture" });
  const authorizeURL = ORIGIN + "/oauth/authorize?" + params;
  const requests = [];
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  async function attach(context, page) {
    // Playwright route() does not intercept every redirected URL. Chromium Fetch
    // pauses every hop, preserving real redirects, cookies and CSP without DNS.
    const cdp = await context.newCDPSession(page);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    cdp.on("Fetch.requestPaused", async ({ requestId, request: req }) => {
      try {
        const url = new URL(req.url);
        let result;
        if (url.origin === new URL(CALLBACK).origin) {
          assert.equal(url.pathname, "/callback");
          assert.ok(url.searchParams.get("code"));
          assert.equal(url.searchParams.get("state"), "browser-fixture");
          result = new Response("<h1>Fixture callback received</h1>", { headers: { "Content-Type": "text/html" } });
        } else {
          assert.equal(url.origin, ORIGIN, "unexpected network request blocked by fixture");
          const headers = new Headers(req.headers);
          if (req.method === "POST") {
            assert.equal(headers.get("Origin"), ORIGIN, "real form navigation preserves same-origin Origin");
            requests.push({ path: url.pathname, method: req.method });
          }
          result = await worker.fetch(new Request(req.url, { method: req.method, headers, ...(req.postData ? { body: req.postData } : {}) }), env);
        }
        const responseHeaders = [...result.headers].filter(([name]) => name.toLowerCase() !== "set-cookie").map(([name, value]) => ({ name, value }));
        for (const value of result.headers.getSetCookie()) responseHeaders.push({ name: "Set-Cookie", value });
        await cdp.send("Fetch.fulfillRequest", { requestId, responseCode: result.status, responseHeaders, body: Buffer.from(await result.arrayBuffer()).toString("base64") });
      } catch (error) {
        console.error(error);
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
      }
    });
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await attach(context, page);
  await page.goto(authorizeURL);
  const checkbox = page.getByRole("checkbox");
  assert.equal(await checkbox.isChecked(), false);
  await page.getByLabel("WORKS APIキー", { exact: true }).fill(KEY);
  await checkbox.check();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile layout fits viewport");
  await mkdir("test-artifacts", { recursive: true });
  await page.screenshot({ path: "test-artifacts/works-login-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "接続を許可", exact: true }).click();
  await page.waitForURL(CALLBACK + "?**");
  let cookie = (await context.cookies(ORIGIN)).find((c) => c.name === SESSION);
  assert.ok(cookie);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(cookie.domain, "works-auth.test");
  assert.equal(cookie.path, "/");
  assert.ok(cookie.expires > Date.now() / 1000 + 29.99 * 86400);
  const originalExpiry = cookie.expires;
  const saved = await context.storageState();
  const restored = await browser.newContext({ storageState: saved });
  const restoredPage = await restored.newPage();
  await attach(restored, restoredPage);
  await restoredPage.goto(authorizeURL);
  assert.equal(await restoredPage.locator("input[type=password]").count(), 0, "persistent-cookie restore retains verified browser");
  await restored.close();
  await page.goto(authorizeURL);
  assert.equal(await page.locator("input[type=password]").count(), 0);
  assert.equal(await page.getByRole("checkbox").isChecked(), true);
  assert.equal(await page.evaluate(() => document.cookie), "");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.screenshot({ path: "test-artifacts/works-remembered-mobile.png", fullPage: true });
  assert.equal(new URL(page.url()).pathname, "/oauth/authorize", "remembered GET does not grant");
  await page.getByRole("button", { name: "接続を許可", exact: true }).click();
  await page.waitForURL(CALLBACK + "?**");
  cookie = (await context.cookies(ORIGIN)).find((c) => c.name === SESSION);
  assert.equal(cookie.expires, originalExpiry, "repeated consent does not extend retention");
  await page.goto(authorizeURL);
  await page.getByRole("checkbox").uncheck();
  await page.getByRole("button", { name: "接続を許可", exact: true }).click();
  await page.waitForURL(CALLBACK + "?**");
  assert.equal((await context.cookies(ORIGIN)).some((c) => c.name === SESSION), false);
  await page.goto(authorizeURL);
  await page.getByLabel("WORKS APIキー", { exact: true }).fill("incorrect-fixture-key");
  await page.getByRole("button", { name: "接続を許可", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("WORKS APIキー", { exact: true }).inputValue(), "");
  await page.getByLabel("WORKS APIキー", { exact: true }).fill(KEY);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "接続を許可", exact: true }).click();
  await page.waitForURL(CALLBACK + "?**");
  await page.goto(authorizeURL);
  await page.getByRole("link", { name: "このブラウザのログイン状態を解除", exact: true }).click();
  assert.ok((await context.cookies(ORIGIN)).some((c) => c.name === SESSION), "GET logout does not revoke");
  await page.getByRole("button", { name: "このブラウザのログイン状態を解除", exact: true }).click();
  await page.getByText("このブラウザのログイン状態を解除しました。", { exact: false }).waitFor();
  assert.equal((await context.cookies(ORIGIN)).some((c) => c.name === SESSION), false);
  assert.equal((await DB.prepare("SELECT COUNT(*) AS count FROM mcp_browser_sessions").first()).count, 0);
  await page.goto(authorizeURL);
  await page.getByLabel("WORKS APIキー", { exact: true }).fill(KEY);
  await page.getByRole("button", { name: "接続を許可", exact: true }).click();
  await page.waitForURL(CALLBACK + "?**");
  assert.equal((await context.cookies(ORIGIN)).some((c) => c.name === SESSION), false);
  assert.ok(requests.some((r) => r.path === "/oauth/logout"));
  await context.close();
  console.log("PASS: synthetic HTTPS Chromium checkbox on/off, consent redirects, persisted cookie restoration, HttpOnly/host/security flags, fixed expiry, empty web storage, logout, failed retry, unchecked login, mobile width");
} finally {
  if (browser) await browser.close();
  await mf.dispose();
}
