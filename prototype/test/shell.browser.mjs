import {chromium,expect} from '../../worker/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:4173/prototype/';
const artifact=new URL('../test-artifacts/',import.meta.url);
await mkdir(artifact,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const errors=[],requests=[];
const page=await browser.newPage({viewport:{width:1440,height:1000}});
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>{
 const url=new URL(route.request().url());requests.push(url.pathname);
 if(url.origin!=='http://127.0.0.1:4173'||url.pathname.startsWith('/api/'))return route.abort();
 return route.continue();
});
const current=()=>page.locator('.page-current');
const nav=(area)=>page.locator(`.side-links [data-area="${area}"]`);
const metrics=()=>page.evaluate(()=>({...window.worksPrototype.metrics}));
let accept=true,beforeUnloadWarnings=0;
page.on('dialog',dialog=>{if(dialog.type()==='beforeunload')beforeUnloadWarnings++;return accept?dialog.accept():dialog.dismiss();});
try {
 await page.goto(base);await expect(current().getByRole('heading',{name:'ホーム',exact:true})).toBeVisible();
 await expect(page.locator('.panel')).toBeVisible();await expect(page.locator('.app-tabs')).toBeHidden();
 await page.screenshot({path:new URL('desktop-home.png',artifact).pathname,fullPage:true});
 await current().locator('.primary-link').click();await expect(current().locator('.project-card')).toHaveCount(3);
 await current().locator('[href="/ss/ss-101/"]').click();await expect(current().locator('#trial-note')).toBeVisible();
 await page.screenshot({path:new URL('desktop-ss.png',artifact).pathname,fullPage:true});
 const detailURL=page.url();await page.reload();await expect(current().locator('#trial-note')).toBeVisible();assert.equal(page.url(),detailURL);
 assert.equal((await metrics()).authInitializations,1);
 await current().locator('#trial-note').fill('未保存のサンプル');accept=false;
 await nav('home').click();await expect(current().locator('#trial-note')).toHaveValue('未保存のサンプル');assert.equal(page.url(),detailURL);
 await page.goBack();await expect(current().locator('#trial-note')).toHaveValue('未保存のサンプル');await expect(page).toHaveURL(detailURL);
 accept=true;await current().getByRole('button',{name:'試作メモを保存',exact:true}).evaluate(button=>{button.click();button.click();});await expect(current().locator('#draft-status')).toContainText('保存しました');assert.equal((await metrics()).saves,1);
 await nav('home').click();await expect(current().locator('.welcome')).toBeVisible();
 await page.goBack();

 await expect(current().locator('#trial-note')).toHaveValue('未保存のサンプル');
 accept=false;await current().locator('#trial-note').fill('進むをキャンセルする合成編集');
 await page.goForward();await expect(page).toHaveURL(detailURL);await expect(current().locator('#trial-note')).toHaveValue('進むをキャンセルする合成編集');
 await page.evaluate(()=>location.reload());await expect.poll(()=>beforeUnloadWarnings).toBe(1);await expect(current().locator('#trial-note')).toHaveValue('進むをキャンセルする合成編集');
 accept=true;await page.goForward();await expect(current().locator('.welcome')).toBeVisible();
 // Repeated entry/disposal must never accumulate listeners or write on read.
 for(let i=0;i<20;i++){await current().locator('.primary-link').click();await expect(current().locator('.project-card')).toHaveCount(3);await nav('home').click();await expect(current().locator('.welcome')).toBeVisible();}
 const after=await metrics();assert.equal(after.authInitializations,1);assert.equal(after.mounts,after.unmounts);assert.equal(after.saves,1);
 await nav('teaching').click();await expect(current()).toContainText('まだ統合していません');await expect(current().locator('a.external[href="https://works.lrnr.jp/tutor/"]')).toContainText('従来画面を開く');
 await page.goto(base+'#!/ss/ss-101/');await expect(current().locator('#trial-note')).toBeVisible();
 await page.emulateMedia({media:'print'});await expect(page.locator('.panel')).toBeHidden();await expect(page.locator('.app-tabs')).toBeHidden();await expect(current().locator('.project-browser')).toBeHidden();await expect(current().locator('.project-detail')).toBeVisible();
 await page.pdf({path:new URL('ss-print.pdf',artifact).pathname,format:'A4'});await page.emulateMedia({media:'screen'});
 for(const width of [320,390,768]) {
  await page.setViewportSize({width,height:844});await page.goto(base);await expect(current().locator('.welcome')).toBeVisible();
  await expect(page.locator('.app-tabs')).toBeVisible();assert.ok((await page.locator('.app-tabs').boundingBox()).y+67<=844);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`mobile-home-${width}.png`,artifact).pathname,fullPage:true});
  await page.locator('.app-tabs [data-area="more"]').focus();await page.keyboard.press('Enter');await expect(current()).toContainText('制作の仕事');
  await current().locator('.legacy-card.ready').click();await expect(current().locator('.project-card')).toHaveCount(3);
  await page.screenshot({path:new URL(`mobile-ss-list-${width}.png`,artifact).pathname,fullPage:true});
  await current().locator('[href="/ss/ss-101/"]').click();await expect(current().locator('#trial-note')).toBeVisible();
  if(width<=650)await expect(current().locator('.project-browser')).toBeHidden();
  else await expect(current().locator('.project-browser')).toBeVisible();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`mobile-ss-detail-${width}.png`,artifact).pathname,fullPage:true});
 }
 for(const fixture of ['empty','error','slow']) {
  await page.goto(base+`?fixture=${fixture}#!/ss/`);
  if(fixture==='empty')await expect(current()).toContainText('表示する案件はありません');
  if(fixture==='error'){await expect(current().getByRole('alert')).toContainText('表示できません');await expect(current().getByRole('button',{name:'再試行'})).toBeVisible();}
  if(fixture==='slow'){await page.locator('.app-tabs [data-area=home]').click();await expect(current().locator('.welcome')).toBeVisible();await page.waitForTimeout(500);assert.equal((await metrics()).mounts,(await metrics()).unmounts);}
 }
 // A deterministic viewport-shrink simulation is supplementary to real iPhone testing.
 const keyboard=await browser.newPage({viewport:{width:390,height:844}});
 await keyboard.addInitScript(()=>{
   const viewport=new EventTarget();Object.assign(viewport,{height:844,width:390,offsetTop:0,offsetLeft:0,pageTop:0,pageLeft:0,scale:1});
   Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
   window.keyboardFixture={show(){viewport.height=380;viewport.dispatchEvent(new Event('resize'));},hide(){viewport.height=844;viewport.dispatchEvent(new Event('resize'));}};
 });
 await keyboard.goto(base+'#!/ss/ss-101/');await expect(keyboard.locator('.page-current #trial-note')).toBeVisible();
 await keyboard.locator('.page-current #trial-note').focus();await keyboard.evaluate(()=>keyboardFixture.show());
 await expect(keyboard.locator('.app-tabs')).toBeHidden();
 await expect.poll(async()=>{const box=await keyboard.locator('.page-current #trial-note').boundingBox();return box.y>=82&&box.y+box.height<=380;}).toBe(true);
 await keyboard.screenshot({path:new URL('mobile-keyboard-simulation.png',artifact).pathname});
 await keyboard.evaluate(()=>keyboardFixture.hide());await expect(keyboard.locator('.app-tabs')).toBeVisible();await keyboard.close();
 assert.deepEqual(errors,[]);assert.ok(!requests.some(path=>path.startsWith('/api/')));
 console.log('PASS Framework7 shell: direct URL/reload, Back/Forward, unsaved cancellation, 20 mount/unmount cycles, one auth init, one save, no API requests, print, mobile/desktop and empty/error/stale reads.');
} finally {await browser.close();}
