import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const artifacts = new URL('../test-artifacts/home-layout/', import.meta.url);
const base = 'https://home-layout.test';
const temporarilyHidden = ['/workflow/', '/wiki/', '/kdp/', '/ss/'];
const menuPaths = ['/', '/tutor/', '/material/', '/admission/', '/todo/', '/memo/'];
const layoutKey = 'works-home-dashboard-v1:' + createHash('sha256').update('home-fixture@example.test').digest('hex');
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
  await context.addInitScript(({ key, shortcuts }) => {
   if (localStorage.getItem(key) === null) {
    localStorage.setItem(key, JSON.stringify({ version: 1, widgets: ['lessons', 'todo', 'shortcuts'], shortcuts }));
   }
  }, { key: layoutKey, shortcuts: [...temporarilyHidden, '/todo/'] });
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
  assert.deepEqual(errors, [], 'Home failed during boot');
  const widgets = page.locator('.dashboard-widget');
  await expect(widgets).toHaveCount(3);
  await expect(widgets.first()).toHaveAttribute('data-id', 'lessons');
  await expect(page.locator('[data-content="lessons"]')).toHaveAttribute('aria-busy', 'false');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const menu = page.locator('#home-navigation');
  if (width < 1024) await menu.locator('summary').click();
  await expect(menu.locator('nav')).toBeVisible();
  assert.deepEqual(await menu.locator('nav a').evaluateAll(links => links.map(link => link.getAttribute('href'))), menuPaths);
  await expect(menu.locator('nav > span')).toHaveText(['授業・教材', '業務']);
  if (width < 1024) {
   await page.keyboard.press('Escape');
   await expect(menu.locator('summary')).toBeFocused();
  }
  const shortcuts = page.locator('.dashboard-shortcut-links a');
  await expect(shortcuts).toHaveCount(1);
  await expect(shortcuts).toHaveAttribute('href', '/todo/');
  const linkHeight = await page.locator('[data-id=lessons] .widget-link').evaluate(el => el.getBoundingClientRect().height);
  assert(linkHeight >= (width <= 640 ? 44 : 36));
  await page.screenshot({ path: fileURLToPath(new URL(width + '-dashboard.png', artifacts)) });

  const open = page.locator('#open-home-settings');
  const dialog = page.getByRole('dialog', { name: '設定', exact: true });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '表示を更新' }).locator('svg[aria-hidden=true]')).toBeVisible();
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

  await open.click();
  await page.locator('#dashboard-edit').click();
  const options = page.locator('#dashboard-shortcuts input');
  assert.deepEqual(await options.evaluateAll(inputs => inputs.map(input => input.value)), menuPaths.slice(1));
  await page.locator('#dashboard-shortcuts input[value="/memo/"]').check();
  await page.locator('#dashboard-save').click();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).shortcuts, layoutKey);
  assert.deepEqual([...saved].sort(), [...temporarilyHidden, '/todo/', '/memo/'].sort());
  await page.reload();
  await expect(shortcuts).toHaveCount(2);
  assert.deepEqual(await shortcuts.evaluateAll(links => links.map(link => link.getAttribute('href'))), ['/todo/', '/memo/']);
  assert.deepEqual(errors, []);
  await context.close();
 }
 console.log('Home local fixture: four viewports, settings focus/return, touch targets, edit preview order/cancel, menu and retained shortcut preferences PASS');
} finally {
 await browser.close();
}
