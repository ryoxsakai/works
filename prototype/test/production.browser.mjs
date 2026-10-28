import {chromium,expect} from '../../worker/node_modules/@playwright/test/index.mjs';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4173',browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const artifact=new URL('../test-artifacts/production/',import.meta.url);await mkdir(artifact,{recursive:true});
const rows=[{id:'real-shaped-1',name:'Synthetic English <img src=x onerror=alert(1)>',status:'問題作成中',deadline:'2026-11-01',memo:'Synthetic current SS memo',remaining_days:4},{id:'real-shaped-2',name:'Synthetic Complete',status:'完了',deadline:'2026-10-20',memo:null,remaining_days:-8}];
let signedIn=true,status=200,reads=0,authInitializations=0,logoutCalls=0,release=null,held=false;
const methods=[],errors=[];const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',async route=>{
 const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
 if(url.pathname==='/shared/auth.js')return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=>"synthetic-browser-token";export function watchAuth(o){window.fixtureAuthInitializations=(window.fixtureAuthInitializations||0)+1;queueMicrotask(()=>${signedIn}?o.onSignedIn({email:'synthetic@example.test'}):o.onSignedOut());}export function signIn(path){window.fixtureLoginPath=path;window.fixturePending=localStorage.works_pending_destination;}export async function signOutUser(){await fetch('/fixture-logout',{method:'POST'});}`});
 if(url.pathname==='/fixture-logout'){logoutCalls++;signedIn=false;return route.fulfill({json:{ok:true}});}
 if(url.pathname==='/api/ss-projects'){
  methods.push(route.request().method());reads++;assert.equal(route.request().headers().authorization,'Bearer synthetic-browser-token');
  if(held)await new Promise(resolve=>release=resolve);
  return route.fulfill({status,json:status===200?rows:{error:'synthetic failure'}});
 }
 if(url.pathname.startsWith('/api/'))throw new Error('unexpected API '+url.pathname);
 return route.continue();
});
let caseNumber=0;const fresh=route=>page.goto(base+'/app/?case='+ ++caseNumber+'#!'+route);
const current=()=>page.locator('.page-current');const nav=area=>page.locator(`.side-links [data-area="${area}"]`);
try {
 signedIn=false;await page.goto(base+'/app/#!/ss/real-shaped-1/');await expect(page.locator('#app-sign-in')).toBeVisible();assert.equal(reads,0);await page.locator('#app-sign-in').click();assert.equal(await page.evaluate(()=>fixtureLoginPath),'/tutor/');assert.equal(await page.evaluate(()=>fixturePending),'/app/');
 signedIn=true;await page.goto(base+'/app/?case=after-login');await expect(current().locator('.project-memo')).toHaveText(rows[0].memo);assert.equal(await page.evaluate(()=>fixtureAuthInitializations),1);await expect(current().locator('progress,textarea,#draft-form')).toHaveCount(0);await expect(current().locator('img')).toHaveCount(0);assert.ok(!(await page.locator('body').innerText()).includes('サンプル表示'));await expect(current().locator('a.external[href="/ss/"]')).toHaveCount(2);
 rows[0].name='英語・読解問題の作成（合成検証）';await page.getByRole('button',{name:'更新',exact:true}).click();await expect(current().locator('.project-detail h2')).toHaveText(rows[0].name);
 await page.screenshot({path:new URL('desktop-ss.png',artifact).pathname,fullPage:true});
 const deep=page.url();await page.reload();await expect(current().locator('.project-memo')).toHaveText(rows[0].memo);assert.equal(page.url(),deep);
 for(let i=0;i<10;i++){await nav('home').click();await expect(current().locator('.welcome')).toBeVisible();await current().locator('.primary-link').click();await expect(current().locator('.project-card')).toHaveCount(1);}
 assert.equal(await page.evaluate(()=>fixtureAuthInitializations),1);assert.ok(methods.every(method=>method==='GET'));
 await current().locator('#show-completed').check();await expect(current().locator('.project-card')).toHaveCount(2);await current().locator('#project-sort').selectOption('name');await current().locator('#sort-direction').click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.works_ss_sort)),{key:'name',direction:'desc'});
 await current().locator('[href="/ss/real-shaped-1/"]').click();await expect(current().locator('.project-memo')).toHaveText(rows[0].memo);await page.goBack();await expect(current().locator('#show-completed')).toBeChecked();await page.goForward();await expect(current().locator('.project-memo')).toHaveText(rows[0].memo);
 await page.getByRole('button',{name:'テーマ',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.setViewportSize({width:390,height:844});await expect(page.locator('.app-tabs')).toBeVisible();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL('mobile-ss.png',artifact).pathname,fullPage:true});await page.emulateMedia({media:'print'});await expect(page.locator('.app-tabs')).toBeHidden();await expect(current().locator('.project-detail')).toBeVisible();await page.pdf({path:new URL('ss.pdf',artifact).pathname,format:'A4'});await page.emulateMedia({media:'screen'});
 // An expired response clears both the current and retained route DOM; Back cannot recover it.
 status=401;await page.getByRole('button',{name:'更新',exact:true}).click();await expect(page.locator('#app')).toBeHidden();await expect(page.locator('#app-sign-in')).toBeVisible();assert.ok(!(await page.content()).includes('Synthetic current SS memo'));await page.goBack();await expect(page.locator('#app')).toBeHidden();assert.ok(!(await page.content()).includes('Synthetic current SS memo'));
 status=200;await fresh('/ss/real-shaped-1/');await expect(current().locator('.project-memo')).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'works_session_token',newValue:null})));await expect(page.locator('#app')).toBeHidden();assert.ok(!(await page.content()).includes('Synthetic current SS memo'));
 // Logout fences a request that was already in flight; late data must never repopulate DOM.
 held=true;await fresh('/ss/real-shaped-1/');await expect.poll(()=>!!release).toBe(true);await page.getByRole('button',{name:'ログアウト',exact:true}).click();await expect(page.locator('#app')).toBeHidden();signedIn=false;held=false;release();await expect(page.locator('#app-sign-in')).toBeVisible();assert.ok(!(await page.content()).includes('Synthetic current SS memo'));assert.equal(logoutCalls,1);await expect(page).toHaveURL(base+'/app/');await expect(page.locator('#app-sign-in')).toBeVisible();
 signedIn=true;
 for(const responseStatus of [403,409,503]){status=responseStatus;await fresh('/ss/');if(responseStatus===403){await expect(page.locator('#app-sign-in')).toBeVisible();await expect(page.locator('#app')).toBeHidden();}else {await expect(current().getByRole('alert')).toContainText('表示できません');const before=reads;status=200;await current().getByRole('button',{name:'再試行'}).click();await expect(current().locator('.project-card')).toHaveCount(1);assert.equal(reads,before+1);}}
 status=200;rows.length=0;await fresh('/ss/');await expect(current()).toContainText('表示する案件はありません');assert.deepEqual(errors,[]);assert.ok(methods.every(method=>method==='GET'));
 console.log('PASS production built app: real-shaped API GET/auth headers, registered callback, no sample/write controls, sort parity, repeated navigation, direct URL, logout/401/403/cross-tab/late response fencing, 409/5xx, empty, XSS, dark/mobile and print.');
}finally{await context.close();await browser.close();}
