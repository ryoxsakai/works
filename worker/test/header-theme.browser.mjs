import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = fileURLToPath(new URL("../test-artifacts/header-theme/", import.meta.url));
fs.mkdirSync(artifacts, { recursive: true });
const base = 'https://works-header.test';
const paths = ['/', '/tutor/', '/material/', '/admission/', '/wiki/', '/memo/', '/todo/', '/kdp/', '/ss/', '/material-print/'];
const authStub = `export const getSessionToken = () => 'qa';
export const getGoogleAccessToken = async () => 'qa';
export const signIn = () => { window.qaSignIn = true; };
export const signOutUser = async () => { window.qaSignOut = true; };
export const watchAuth = ({onSignedIn,onSignedOut}) => {
  window.qaAuth = {onSignedIn,onSignedOut};
  if (localStorage.getItem('qa_signed_in') === 'yes') onSignedIn?.({email:'qa@example.test',picture:''});
  else onSignedOut?.();
};`;
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext();
  // Synthetic origin: no production credentials, data, or external requests.
  await context.route('**/*', async r => {
    const url = new URL(r.request().url());
    if (url.origin === 'https://www.googleapis.com') return r.fulfill({contentType:'application/json',body:'{"items":[]}'});
    if (url.origin !== base) return r.abort();
    if (url.pathname === '/shared/auth.js') return r.fulfill({contentType:'text/javascript',body:authStub});
    if (url.pathname.startsWith('/api/')) {
      const isList = /^\/api\/(goal-templates|students|materials|material-categories|periods|calendars|records|curriculum|schedules|schedule-names|ss-projects|admissions|material-library\/(folders|files))(\/|$)/.test(url.pathname);
      return r.fulfill({contentType:'application/json',body:JSON.stringify(isList ? [] : {items:[],books:[],pages:[],memos:[],tasks:[],categories:[],calendars:[],events:[],files:[],folders:[],students:[],schedules:[],materials:[]})});
    }
    const file = path.join(root, decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root) || !fs.existsSync(file)) return r.fulfill({status:404,body:''});
    const contentType = ({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[path.extname(file)] || 'application/octet-stream';
    return r.fulfill({contentType,body:fs.readFileSync(file)});
  });
  const page = await context.newPage();
  const report = [];
  await page.goto(base + "/");
  for (const signedIn of [false, true]) {
    for (const width of [320,375,768,1024,1440,1920]) {
      await page.setViewportSize({width,height:900});
      for (const path of paths) {
        await page.evaluate(value => localStorage.setItem('qa_signed_in',value), signedIn ? 'yes':'no');
        await page.goto(base + path);
        if (!signedIn && ["/tutor/", "/material/", "/admission/", "/ss/", "/material-print/"].includes(path)) await page.waitForURL(base + "/");
        await page.waitForFunction(() => !!window.qaAuth);
        await page.locator('.works-theme-control select').waitFor();
        if (new URL(page.url()).pathname === '/') {
          await page.waitForFunction(expected => document.querySelector('#home-auth-action').getAttribute('aria-label') === expected, signedIn ? 'ログアウト' : 'Googleでログイン');
        } else {
          const signOut = page.locator(path === '/memo/' ? '#memo-user-bar button' : '#sign-out');
          assert.equal(await signOut.isVisible(), signedIn, `${path} auth control`);
        }
        // This harness isolates header geometry from memo's full-screen sign-in view.
        if (path === '/memo/') await page.locator('#login-screen').evaluate(el => el.style.display = 'none');
        for (const theme of ['light','dark']) {
          await page.selectOption('.works-theme-control select', theme);
          await page.waitForTimeout(180); // Let existing card/button color transitions settle.
          const geometry = await page.evaluate(() => {
            const h = document.querySelector('.works-header');
            const rect = h.getBoundingClientRect();
            const children = [...h.querySelectorAll('h1, .works-header-actions, select, summary, button:not([hidden])')].filter(e=>e.getBoundingClientRect().width);
            const menu = h.querySelector('.works-navigation');
            const style = getComputedStyle(menu);
            const summary = menu.querySelector('summary').getBoundingClientRect();
            const themeControl = h.querySelector('select').getBoundingClientRect();
            return {menuTop:style.marginTop,menuPadding:style.paddingTop,menuBorder:style.borderTopWidth,
              menuCenter:summary.y+summary.height/2,themeCenter:themeControl.y+themeControl.height/2,
              left:rect.left,right:rect.right,width:innerWidth,theme:document.documentElement.dataset.theme,bg:getComputedStyle(h).backgroundColor,
              clipped:children.filter(e=>{const r=e.getBoundingClientRect();return r.left<0||r.right>innerWidth+1}).map(e=>e.outerHTML)};
          });
          assert.equal(geometry.left,0,`${path} ${width} header left`);
          assert.equal(geometry.right,width,`${path} ${width} header right`);
          assert.equal(geometry.theme,theme);
          assert.equal(geometry.menuTop, '0px', `${path} menu top margin`);
          assert.equal(geometry.menuPadding, '0px', `${path} menu top padding`);
          assert.equal(geometry.menuBorder, '0px', `${path} menu top border`);
          assert.ok(Math.abs(geometry.menuCenter - geometry.themeCenter) < 2, `${path} menu alignment`);
          assert.deepEqual(geometry.clipped,[],`${path} ${width} clipped controls`);
          await page.locator('.works-navigation summary').click();
          const nav = await page.locator('.works-navigation nav').boundingBox();
          assert(nav.x>=0 && nav.x+nav.width<=width+1,`${path} ${width} clipped menu`);
          await page.keyboard.press('Escape');
          if (width===375 || width===1440) {
            await page.screenshot({path:`${artifacts}/${path.replaceAll('/','')||'home'}-${width}-${theme}-${signedIn?'in':'out'}.png`,fullPage:true});
          }
        }
        await page.emulateMedia({media:'print'});
        assert.equal(await page.locator('.works-header').isVisible(), false,`${path} print header`);
        await page.emulateMedia({media:'screen'});
        report.push({path,displayedPath:new URL(page.url()).pathname,width,signedIn,result:'pass'});
      }
    }
  }
  await page.goto(base + '/');
  assert.equal(await page.locator('.module-card[href="/material-print/"]').count(),0);
  assert.equal(await page.locator('#operations a[href="/wiki/"] h3').innerText(),'Wiki');
  assert.deepEqual(await page.locator('.module-section').evaluateAll(es=>es.map(e=>e.id)),['teaching','operations','creation']);
  await page.selectOption('.works-theme-control select','dark');
  await page.reload();
  assert.equal(await page.locator('.works-theme-control select').inputValue(),'dark');
  await page.goto(base+'/kdp/');
  assert.equal(await page.locator('.works-theme-control select').inputValue(),'dark');
  const second = await context.newPage();
  await second.goto(base+'/ss/');
  await second.locator('.works-theme-control select').waitFor();
  await page.selectOption('.works-theme-control select','light');
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await second.selectOption('.works-theme-control select','system');
  await second.emulateMedia({colorScheme:'dark'});
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await second.emulateMedia({colorScheme:'light'});
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  // Shared navigation must invoke the existing dirty/busy guard before navigating.
  await page.goto(base+'/wiki/');
  await page.locator('.works-theme-control select').waitFor();
  await page.evaluate(()=>{document.querySelector('.works-home').onclick=e=>{window.qaGuard=true;e.preventDefault();};});
  await page.locator('.works-navigation summary').click();
  await page.locator('.works-navigation a[href="/kdp/"]').click();
  assert.equal(await page.evaluate(()=>window.qaGuard),true);
  assert.equal(new URL(page.url()).pathname,'/wiki/');
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({matrix:report,themePersistence:'pass',navigation:'pass',crossTab:'pass',osFollow:'pass',print:'pass'},null,2));
  console.log(`Passed ${report.length} page/width/auth combinations, each light/dark + print; theme persistence, cross-tab, OS follow, navigation guard, home categories.`);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
