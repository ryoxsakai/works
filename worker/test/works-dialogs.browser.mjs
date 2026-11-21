import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const base = 'https://works-dialogs.test';
const root = new URL('../../', import.meta.url);
const pages = [
  ['/tutor/', '#settings-modal'],
  ['/material/', '#new-folder-modal'],
  ['/admission/', '#admission-filter-modal'],
  ['/todo/', '#capture-sheet'],
  ['/memo/', '#memo-modal'],
];
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
  ? { executablePath: process.env.BROWSER_EXECUTABLE }
  : {});
try {
  const page = await browser.newPage();
  // Exercise the production markup and CSS with no account, writes or CDN calls.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== base || route.request().method() !== 'GET') return route.abort();
    const name = url.pathname.slice(1) || 'index.html';
    const path = name.endsWith('/') ? name + 'index.html' : name;
    if (!/\.(html|css)$/.test(path)) return route.abort();
    try {
      let body = readFileSync(new URL(path, root), 'utf8');
      if (path.endsWith('.html')) body = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      return route.fulfill({ contentType: path.endsWith('.html') ? 'text/html' : 'text/css', body });
    } catch {
      return route.abort();
    }
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    for (const [path, selector] of pages) {
      await page.goto(base + path);
      assert.equal(await page.locator('link[href^="/shared/works-dialogs.css"]').count(), 1, path);
      const d = page.locator(selector);
      const result = await d.evaluate(el => {
        const style = () => getComputedStyle(document.documentElement).overflowY;
        document.documentElement.dataset.theme = "light";
        el.classList.remove("hidden");
        const before = style();
        el.show();
        const nonmodal = style();
        el.close();
        el.showModal();
        return { before, nonmodal, open: style(), modal: el.matches(':modal'),
          backdrop: getComputedStyle(el, '::backdrop').backgroundColor,
          overscroll: getComputedStyle(el).overscrollBehavior,
          blur: getComputedStyle(el, '::backdrop').backdropFilter };
      });
      assert.equal(result.before, result.nonmodal, `${path} inline dialog does not lock the page`);
      assert.equal(result.modal, true);
      assert.equal(result.open, 'hidden');
      assert.equal(result.backdrop, 'rgba(16, 18, 24, 0.36)', `${path} shared backdrop`);
      assert.equal(result.overscroll, 'contain');
      assert.equal(result.blur, 'none');
      await page.keyboard.press('Escape');
      assert.equal(await d.evaluate(el => el.open), false, `${path} closes with Escape`);
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), result.before);
      if (path === '/todo/') {
        const opacity = await page.locator('#detail').evaluate(el => {
          el.showModal();
          return getComputedStyle(el, '::backdrop').backgroundColor;
        });
        assert.equal(opacity, width >= 1000 ? 'rgba(0, 0, 0, 0)' : result.backdrop);
      }
    }
  }
  console.log('Works dialog baseline: 5 services × 4 viewports, native open/Escape, overlay and scroll isolation pass');
} finally {
  await browser.close();
}
