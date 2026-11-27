import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createFixture } from './next-lesson-fixture.mjs';

const fixture = await createFixture();
const browser = await chromium.launch(
  process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {},
);
const services = [
  ['tutor', '[data-page-tab]', '[data-page-tab-panel] > .panel > .panel-header:first-child h2'],
  ['material', '[data-material-tab]', '.material-heading h2'],
  ['admission', null, '.admission-heading h2'],
  ['todo', null, '#view-title'],
  ['memo', null, '.memo-heading h2'],
];
const out = new URL('../test-artifacts/service-spacing/', import.meta.url);
await mkdir(out, { recursive: true });
try {
  for (const width of [320, 390, 640, 641, 730, 731, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('works_session_token', 'qa'));
    const page = await context.newPage();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== fixture.base) return route.abort();
      if (url.pathname.startsWith('/api/material-library')) {
        return route.fulfill({ json: [] });
      }
      if (url.pathname === '/api/todo') {
        return route.fulfill({ json: { tasks: [], roles: [], categories: [], revision: 1, plannerVersion: 1 } });
      }
      if (url.pathname === '/api/memo') return route.fulfill({ json: { memos: [], categories: [], revision: 1 } });
      if (url.pathname === '/api/admissions') return route.fulfill({ json: [] });
      return route.continue();
    });
    try {
      for (const [service, tabSelector, titleSelector] of services) {
        await page.goto(`${fixture.base}/${service}/`);
        const view = width <= 730 ? page.frameLocator("iframe:not([inert])") : page;
        const title = view.locator(`${titleSelector}:visible`);
        await expect(title).toBeVisible();
        const tabs = tabSelector ? await view.locator(tabSelector).all() : [null];
        for (const tab of tabs) {
          if (tab) {
            await tab.focus();
            await page.keyboard.press('Enter');
            await expect(tab).toHaveAttribute('aria-selected', 'true');
            await expect(tab).toBeFocused();
          }
          const layout = await title.evaluate((el, key) => {
            const header = document.querySelector('.works-header');
            const column = key === 'todo' ? document.querySelector('.planner-content') : document.querySelector('main');
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            return {
              top: r.top - header.getBoundingClientRect().bottom,
              left: r.left - column.getBoundingClientRect().left,
              size: Number.parseFloat(s.fontSize),
              height: Number.parseFloat(s.lineHeight),
              overflow: document.documentElement.scrollWidth - innerWidth,
            };
          }, service);
          const message = `${service} at ${width}px: ${JSON.stringify(layout)}`;
          assert.ok(Math.abs(layout.top - (width <= 730 ? 10 : 16)) < 1, message);
          assert.ok(Math.abs(layout.left - (width <= 730 ? 16 : Math.min(28, Math.max(16, width * 0.02)))) < 1, message);
          assert.equal(layout.size, width <= 730 ? 17 : 20, message);
          assert.ok(Math.abs(layout.height - layout.size * 1.3) < 0.1, message);
          assert.ok(layout.overflow <= 1, message);
          if (tab) {
            const layout = await tab.evaluate(el => getComputedStyle(el.closest('.page-tabs')).position);
            assert.equal(layout, width <= 640 ? 'fixed' : 'sticky', message);
          }
        }
        if (width === 390 || width === 1440) {
          await page.screenshot({ path: new URL(`${width}-${service}.png`, out).pathname });
        }
      }
    } finally {
      await context.close();
    }
  }
  assert.equal(fixture.control.writes.length, 0);
  console.log('Common header/title spacing: five services, eight viewport sizes, keyboard tab switching and no writes.');
} finally {
  await browser.close();
  await fixture.close();
}
