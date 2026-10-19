import { lessonEventRef } from "../../shared/lesson-plan.js";
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
async function openThemeSettings(page) {
  await page.locator('.works-header button[aria-label="設定"]').click();
  const appearance = page.locator('dialog[open] [role="tab"][data-tab="appearance"]');
  if (await appearance.count()) await appearance.click();
  await page.locator('dialog[open] input[type="radio"][value="light"]').waitFor({state:'visible'});
}
async function selectTheme(page, value) {
  await openThemeSettings(page);
  await page.locator(`dialog[open] input[type="radio"][value="${value}"]`).check();
  await page.locator('dialog[open] button[aria-label="閉じる"]').click();
}
async function selectedTheme(page) {
  await openThemeSettings(page);
  const value=await page.locator('dialog[open] input[type="radio"]:checked').inputValue();
  await page.locator('dialog[open] button[aria-label="閉じる"]').click();
  return value;
}
(async () => {
  const browser = await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext();
  let recordFixtures = false;
  const recordSaves = new Map();
  let memoFixtures = false, failMemoRead = true, failMemoSave = true, releaseMemoSave;
  const memoWrites = [];
  const profiles = new Map([['サンプル生徒',{name:'サンプル生徒',memo:'既存の生徒メモ',print_name:'印刷サンプル'}],['別の生徒',{name:'別の生徒',memo:'別生徒のメモ'}]]);
  // Synthetic origin: no production credentials, data, or external requests.
  await context.route('**/*', async r => {
    const url = new URL(r.request().url());
    if (url.origin === 'https://www.googleapis.com') {
      let items=[];
      if (recordFixtures) {
        if (url.pathname.endsWith('calendarList')) items=[{id:'qa',summary:'代官山',backgroundColor:'#8e24aa'}];
        else {
          const day=new Date(url.searchParams.get('timeMin')).toLocaleDateString('en-CA',{timeZone:'Asia/Tokyo'});
          const names=memoFixtures?['サンプル生徒','別の生徒','取得失敗','空メモ']:['サンプル生徒'];
          items=names.map((summary,i)=>({id:day+(i?'-'+i:''),summary,start:{dateTime:`${day}T${10+i}:00:00+09:00`},end:{dateTime:`${day}T${11+i}:00:00+09:00`}}));
        }
      }
      return r.fulfill({contentType:'application/json',body:JSON.stringify({items})});
    }
    if (url.origin !== base) return r.abort();
    if (url.pathname === '/shared/auth.js') return r.fulfill({contentType:'text/javascript',body:authStub});
    if (url.pathname.startsWith('/api/')) {
      if (recordFixtures) {
        let result=[];
        if(url.pathname==='/api/settings')result={selected_calendars:['qa'],selected_term_ids:[1]};
        if(url.pathname==='/api/years')result=[{id:1,label:'サンプル年度'}];
        if(url.pathname==='/api/terms')result=[{id:1,year_id:1,label:'サンプル学期',start_date:'2000-01-01',end_date:'2099-12-31'}];
        if(url.pathname.startsWith('/api/curriculum/') && r.request().method()==='PUT'){
          const id=decodeURIComponent(url.pathname.slice('/api/curriculum/'.length));recordSaves.set(id,{...recordSaves.get(id),...r.request().postDataJSON()});result={ok:true};
        }
        if(url.pathname==='/api/next-lesson-plan'){
          const id=url.searchParams.get('event_id'),day=id.slice(0,10);
          const source=lessonEventRef({id,summary:'サンプル生徒',start:{dateTime:`${day}T10:00:00+09:00`},end:{dateTime:`${day}T11:00:00+09:00`}},'qa');
          result={source,target:null,reason:'none',lesson_plan:''};
        }
        if(url.pathname==='/api/lesson-plan'&&r.request().method()==='PUT'){
          const body=r.request().postDataJSON(),id=body.target.id;
          recordSaves.set(id,{...recordSaves.get(id),lesson_plan:body.lesson_plan});result=recordSaves.get(id);
        }
        if(url.pathname==='/api/student-prefs'){
          const name=url.searchParams.get('name');
          if(r.request().method()==='PUT'){
            const body=r.request().postDataJSON();memoWrites.push(body);
            if(body.memo==='保存失敗'&&failMemoSave){failMemoSave=false;return r.fulfill({status:500,body:'synthetic save failure'});}
            if(body.memo==='遅延保存')await new Promise(resolve=>{releaseMemoSave=resolve;});
            profiles.set(body.name,{...profiles.get(body.name),...body});result=profiles.get(body.name);
          } else {
            if(name==='取得失敗'&&failMemoRead){failMemoRead=false;return r.fulfill({status:500,body:'synthetic read failure'});}
            result=profiles.get(name)||{name,memo:null,print_name:null};
          }
        }
        if(url.pathname==='/api/curriculum')result=[...recordSaves].map(([calendar_event_id,record])=>({calendar_event_id,...record}));
        return r.fulfill({contentType:'application/json',body:JSON.stringify(result)});
      }
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
        await page.locator('.works-header button[aria-label="設定"]').waitFor();
        assert.equal(await page.locator('.works-header select').count(),0,'theme selector lives inside settings');
        if (new URL(page.url()).pathname === '/') {
          await page.waitForFunction(expected => document.querySelector('#home-auth-action').getAttribute('aria-label') === expected, signedIn ? 'ログアウト' : 'Googleでログイン');
        } else {
          const signOut = page.locator(path === '/memo/' ? '#memo-user-bar button' : '#sign-out');
          assert.equal(await signOut.isVisible(), signedIn, `${path} auth control`);
        }
        // This harness isolates header geometry from memo's full-screen sign-in view.
        if (path === '/memo/') await page.locator('#login-screen').evaluate(el => el.style.display = 'none');
        for (const theme of ['light','dark']) {
          await selectTheme(page, theme);
          await page.waitForTimeout(180); // Let existing card/button color transitions settle.
          const geometry = await page.evaluate(() => {
            const h = document.querySelector('.works-header');
            const rect = h.getBoundingClientRect();
            const children = [...h.querySelectorAll('h1, .works-header-actions, select, summary, button:not([hidden])')].filter(e=>e.getBoundingClientRect().width);
            const menu = h.querySelector('.works-navigation');
            const style = getComputedStyle(menu);
            const summary = menu.querySelector('summary').getBoundingClientRect();
            const themeControl = h.querySelector('button[aria-label="設定"]').getBoundingClientRect();
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
  assert.equal(await page.locator('#automation a[href="/wiki/"] h3').innerText(),'Wiki');
  assert.deepEqual(await page.locator('.module-section').evaluateAll(es=>es.map(e=>e.id)),['teaching','operations','automation','creation']);
  await selectTheme(page,'dark');
  await page.reload();
  assert.equal(await selectedTheme(page),'dark');
  await page.goto(base+'/kdp/');
  assert.equal(await selectedTheme(page),'dark');
  const second = await context.newPage();
  await second.goto(base+'/ss/');
  await second.locator('.works-header button[aria-label="設定"]').waitFor();
  await selectTheme(page,'light');
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await selectTheme(second,'system');
  await second.emulateMedia({colorScheme:'dark'});
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await second.emulateMedia({colorScheme:'light'});
  await second.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  // Shared navigation must invoke the existing dirty/busy guard before navigating.
  await page.goto(base+'/wiki/');
  await page.locator('.works-header button[aria-label="設定"]').waitFor();
        assert.equal(await page.locator('.works-header select').count(),0,'theme selector lives inside settings');
  await page.evaluate(()=>{document.querySelector('.works-home').onclick=e=>{window.qaGuard=true;e.preventDefault();};});
  await page.locator('.works-navigation summary').click();
  await page.locator('.works-navigation a[href="/kdp/"]').click();
  assert.equal(await page.evaluate(()=>window.qaGuard),true);
  assert.equal(new URL(page.url()).pathname,'/wiki/');
  // Record saves stay inside the fixture; never touch production lessons.
  recordFixtures=true;
  await page.evaluate(()=>localStorage.setItem('qa_signed_in','yes'));
  await page.goto(base+'/tutor/');
  await page.locator('[data-page-tab="record"]').click();
  const field=page.locator('#record-tbody .record-plan').first();
  await field.waitFor();
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});
    await selectTheme(page,'light');
    const geometry=await page.locator('#record-table').evaluate(el=>({display:getComputedStyle(el).display,width:el.getBoundingClientRect().width,body:document.body.scrollWidth,viewport:innerWidth}));
    if(width<=640){assert.equal(geometry.display,'block');assert.ok(geometry.body<=width);assert.ok(geometry.width<=width);}
    else assert.equal(geometry.display,'table');
    await field.fill('');
    const empty=await field.evaluate(el=>el.offsetHeight);
    await field.fill('一行目\n日本語の二行目\n三行目');
    assert.ok(await field.evaluate(el=>el.offsetHeight)>empty);
    await field.fill('長い日本語の折り返しを検証します。'.repeat(40));
    assert.ok(await field.evaluate(el=>el.scrollHeight<=el.clientHeight));
    await field.fill('');
    assert.equal(await field.evaluate(el=>el.offsetHeight),empty);
    const savedValue=`${width}pxで保存後に復元する日本語\n二行目\n三行目`;
    await field.fill(savedValue);
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/lesson-plan'&&r.request().method()==='PUT');
    await field.press('Tab');await response;
    await page.reload();await field.waitFor();
    assert.equal(await field.inputValue(),savedValue);
    assert.ok(await field.evaluate(el=>el.offsetHeight)>empty);
    await selectTheme(page,'dark');
    assert.equal(await page.locator('.works-header select').count(),0);
    if(width===390)await page.screenshot({path:path.join(artifacts,'records-390-dark.png'),fullPage:true});
  }
  const initialDate=await page.locator('#record-date-label').innerText();
  await page.locator('.record-day-btn[data-day="prev"]').click();
  await page.locator('.record-day-btn[data-day="prev"]').click();
  const earlierDate=await page.locator('#record-date-label').innerText();
  assert.notEqual(earlierDate,initialDate);
  await page.locator('.record-day-btn[data-day="next"]').click();
  await page.locator('.record-day-btn[data-day="next"]').click();
  assert.equal(await page.locator('#record-date-label').innerText(),initialDate);
  assert.equal(await page.locator('.record-day-btn').count(),2);
  // Shared student memo: the existing profile API is the only persistence target.
  memoFixtures=true;
  await page.setViewportSize({width:390,height:900});await page.reload();
  const editor=name=>page.locator(`.record-student-memo[data-student-name="${name}"]`);
  const memo=editor('サンプル生徒').locator('textarea');
  await page.waitForFunction(()=>document.querySelector('.record-student-memo textarea')?.value==='既存の生徒メモ');
  assert.equal(memoWrites.length,0,'initial reads must not initialize or overwrite notes');
  await page.waitForFunction(()=>document.querySelector('[data-student-name="取得失敗"]')?.dataset.status==='load-error');
  assert.equal(await editor('取得失敗').locator('textarea').isDisabled(),true);
  await editor('取得失敗').getByRole('button',{name:'再試行'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-student-name="取得失敗"]')?.dataset.status==='ready');
  const empty=await editor('空メモ').locator('textarea').evaluate(el=>el.offsetHeight);
  assert.ok(empty<50,'empty note starts as one line');
  await memo.fill('共有するメモ\n二行目\n三行目');await memo.press('Tab');
  await page.waitForFunction(()=>document.querySelector('.record-student-memo')?.dataset.status==='saved');
  assert.ok(await memo.evaluate(el=>el.offsetHeight)>empty);
  const notes='共有するメモ\n二行目\n三行目';
  await page.locator('.record-day-btn[data-day="next"]').click();await memo.waitFor();
  assert.equal(await memo.inputValue(),notes,'same student on another day shares the note');
  await page.locator('.record-student-link').filter({hasText:'サンプル生徒'}).click();
  const profileMemo=page.locator('#student-memo');
  await page.waitForFunction(()=>document.querySelector('#student-memo')?.disabled===false);
  assert.equal(await profileMemo.inputValue(),notes);
  await profileMemo.fill('生徒情報から変更');await profileMemo.press('Tab');
  await page.waitForFunction(()=>document.querySelector('#student-memo-editor')?.dataset.status==='saved');
  await page.locator('[data-page-tab="record"]').click();assert.equal(await memo.inputValue(),'生徒情報から変更');
  await page.reload();await memo.waitFor();
  await page.waitForFunction(()=>document.querySelector('.record-student-memo textarea')?.value==='生徒情報から変更');
  assert.equal(profiles.get('サンプル生徒').print_name,'印刷サンプル');
  await memo.fill('保存失敗');await memo.press('Tab');
  await page.waitForFunction(()=>document.querySelector('.record-student-memo')?.dataset.status==='save-error');
  assert.equal(await memo.inputValue(),'保存失敗');await editor('サンプル生徒').getByRole('button',{name:'再試行'}).click();
  await page.waitForFunction(()=>document.querySelector('.record-student-memo')?.dataset.status==='saved');
  assert.equal(await editor('別の生徒').locator('textarea').inputValue(),'別生徒のメモ');
  await memo.fill('遅延保存');await memo.press('Tab');
  await page.waitForFunction(()=>document.querySelector('.record-student-memo')?.dataset.status==='saving');
  await page.locator('.record-student-link').filter({hasText:'別の生徒'}).click();
  await page.waitForFunction(()=>document.querySelector('#student-memo')?.value==='別生徒のメモ');
  assert.equal(typeof releaseMemoSave,'function');releaseMemoSave();
  await page.waitForFunction(()=>document.querySelector('.record-student-memo')?.dataset.status==='saved');
  assert.equal(await profileMemo.inputValue(),'別生徒のメモ','old save response cannot replace the later student');
  assert.ok(memoWrites.every(body=>Object.keys(body).sort().join(',')==='memo,name'));
  await page.locator('[data-page-tab="record"]').click();
  await page.screenshot({path:path.join(artifacts,'shared-student-memo-390.png'),fullPage:true});
  console.log('Shared student memo: existing data, both views, day changes, reload, autosize, read/save failures and stale save isolation passed.');
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify({matrix:report,themePersistence:'pass',navigation:'pass',crossTab:'pass',osFollow:'pass',print:'pass'},null,2));
  console.log(`Passed ${report.length} page/width/auth combinations, each light/dark + print; theme persistence, cross-tab, OS follow, navigation guard, home categories.`);
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
