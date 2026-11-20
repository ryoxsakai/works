import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = new URL('../test-artifacts/home-layout/', import.meta.url);
const base = 'https://home-layout.test';
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
const auth = `
 export const getSessionToken = () => 'synthetic';
 export const getGoogleAccessToken = async () => 'synthetic';
 export const signIn = () => {};
 export const signOutUser = async () => {};
 export const watchAuth = ({ onSignedIn }) => onSignedIn({ email: 'home-fixture@example.test' });
`;
const mime = {
 '.html': 'text/html; charset=utf-8',
 '.js': 'text/javascript; charset=utf-8',
 '.mjs': 'text/javascript; charset=utf-8',
 '.css': 'text/css; charset=utf-8',
 '.svg': 'image/svg+xml',
 '.png': 'image/png',
};
await mkdir(artifacts, { recursive: true });

try {
 for (const [width, height] of [[320, 480], [390, 844], [768, 900], [1440, 1000]]) {
  const context = await browser.newContext({
   viewport: { width, height },
   colorScheme: 'dark',
   hasTouch: width < 641,
   reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.origin !== base) return route.abort();
   if (url.pathname === '/shared/auth.js') return route.fulfill({ contentType: mime['.js'], body: auth });
   if (url.pathname.startsWith('/api/')) {
    assert.equal(route.request().method(), 'GET');
    if (url.pathname === '/api/settings') return route.fulfill({ json: { selected_calendars: [], excluded_titles: [] } });
    if (url.pathname === '/api/todo') return route.fulfill({ json: { tasks: [] } });
    throw new Error('Unexpected fixture API ' + url.pathname);
   }
   const file = path.join(root, url.pathname + (url.pathname.endsWith('/') ? 'index.html' : ''));
   const body = await readFile(file).catch(() => null);
   return body
    ? route.fulfill({ contentType: mime[path.extname(file)], body })
    : route.fulfill({ status: 404, body: '' });
  });
  await page.goto(base + '/');
  const widgets = page.locator('.dashboard-widget');
  await expect(widgets).toHaveCount(3);
  await expect(widgets.first()).toHaveAttribute('data-id', 'lessons');
  await expect(page.locator('[data-content="lessons"]')).toHaveAttribute('aria-busy', 'false');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const linkHeight = await page.locator('[data-id=lessons] .widget-link').evaluate(el => el.getBoundingClientRect().height);
  assert(linkHeight >= (width <= 640 ? 44 : 36));
  await page.screenshot({ path: fileURLToPath(new URL(width + '-dashboard.png', artifacts)) });

  const open = page.locator('#open-home-settings');
  const dialog = page.getByRole('dialog', { name: '設定', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  const layout = await dialog.evaluate(el => {
   const r = el.getBoundingClientRect(), close = el.querySelector('.modal-close').getBoundingClientRect();
   return { modal: el.matches(':modal'), contained: r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1,
    radius: getComputedStyle(el).borderRadius, background: getComputedStyle(el).backgroundColor,
    target: Math.min(close.width, close.height) };
  });
  assert(layout.modal && layout.contained && layout.target >= 44);
  assert.equal(layout.radius, '8px');
  assert.equal(layout.background, 'rgb(255, 255, 255)');
  await page.screenshot({ path: fileURLToPath(new URL(width + '-settings.png', artifacts)) });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();

  await open.click();
  await page.locator('#dashboard-edit').click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('region', { name: 'ホーム画面の配置' })).toBeVisible();
  await page.locator('[data-move=lessons][data-step="1"]').click();
  await expect(widgets.first()).toHaveAttribute('data-id', 'todo');
  const initial = await widgets.nth(0).boundingBox(), second = await widgets.nth(1).boundingBox();
  if (width >= 900) assert(initial.x < second.x && Math.abs(initial.y - second.y) <= 1);
  else assert(initial.y < second.y);
  await page.screenshot({ path: fileURLToPath(new URL(width + '-editor.png', artifacts)) });
  await page.locator('#dashboard-cancel').click();
  await expect(page.locator('#dashboard-editor')).toBeHidden();
  await expect(widgets.first()).toHaveAttribute('data-id', 'lessons');
  assert.deepEqual(errors, []);
  await context.close();
 }
 console.log('Home local fixture: four viewports, settings focus/return, touch targets, edit preview order and cancel PASS');
} finally {
 await browser.close();
}
