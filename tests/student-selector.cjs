const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; const writes=[];
  page.on('pageerror', e=>errors.push(e.message));
  const calendars=[{id:'d',summary:'代官山'},{id:'t',summary:'TOMAS'}];
  const events={d:['田﨑','田崎','集団 英語'],t:['青木',...Array.from({length:12},(_,i)=>`生徒${i}`)]};
  await page.route('**/*', async route=>{
    const u=new URL(route.request().url());
    const json=body=>route.fulfill({json:body});
    if(u.pathname==='/shared/auth.js') return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=>"test"; export const getGoogleAccessToken=async()=>"test"; export const signIn=()=>{}; export const signOutUser=()=>{}; export const isStandaloneHomeScreenApp=()=>false; export const watchAuth=({onSignedIn})=>setTimeout(()=>onSignedIn({email:"test@example.com"}),0);`});
    if(u.hostname==='www.googleapis.com') {
      if(u.pathname.endsWith('/calendarList')) return json({items:calendars});
      const id=decodeURIComponent(u.pathname.split('/')[4]);
      return json({items:(events[id]||[]).map((name,i)=>({id:id+i,summary:name,start:{dateTime:'2026-10-16T10:00:00Z'},end:{dateTime:'2026-10-16T11:00:00Z'}}))});
    }
    if(u.pathname.startsWith('/api/')) {
      if(route.request().method()!=='GET') writes.push(JSON.parse(route.request().postData()));
      const data={'/api/settings':{selected_calendars:['d','t']},'/api/students':[{name:'田﨑 太郎',calendar_tag:'田﨑'}],'/api/years':[{id:1,label:'2026'}],'/api/terms':[{id:1,year_id:1,label:'後期',start_date:'2026-10-01',end_date:'2026-12-31'}],'/api/student-prefs':{print_name:'既存の印刷氏名',memo:'既存メモ'}};
      return json(data[u.pathname]||[]);
    }
    if(u.hostname==='localhost') {
      const file=path.join(process.cwd(),u.pathname);
      if(fs.existsSync(file)&&fs.statSync(file).isFile()) return route.fulfill({path:file});
      return route.fulfill({status:404,body:''});
    }
    return route.abort();
  });
  await page.goto('http://localhost/tutor/index.html');
  await page.locator('[data-page-tab="curriculum"]').click();
  await page.locator('[data-student-group="代官山 · 個別"]').click();
  await page.getByRole('button',{name:'田﨑 太郎 田﨑',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#student-selector').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#curriculum-name').inputValue(),'田﨑');
  assert.equal(await page.locator('#student-memo').inputValue(),'既存メモ');
  assert.equal(await page.locator('#curriculum-print-name').isVisible(),false);
  await page.locator('#open-curriculum-search-modal').click();
  assert.equal(await page.locator('#curriculum-print-name').inputValue(),'既存の印刷氏名');
  await page.locator('#curriculum-year-select').selectOption('1');
  await page.locator('#curriculum-term-select').selectOption('1');
  await page.screenshot({path:'/tmp/works-students-settings-mobile.png'});
  await page.locator('#curriculum-print-name').fill('印刷用の新氏名');
  await page.locator('#curriculum-term-select').focus();
  await page.locator('#curriculum-filter-form button[type="submit"]').click();
  await page.locator('#curriculum-tbody tr[data-event-id]').waitFor();
  assert.equal(await page.locator('#curriculum-tbody tr[data-event-id]').count(),1);
  assert.equal(await page.locator('#curriculum-tbody tr').getAttribute('data-event-id'),'d0');
  assert.deepEqual(writes,[{name:'田﨑',print_name:'印刷用の新氏名'}]);
  await page.locator('#open-curriculum-search-modal').click();
  await page.locator('#student-lesson-kind').selectOption('group');
  await page.locator('#curriculum-search-modal-close').click();
  assert.equal(await page.locator('[data-student-group="代官山 · 集団"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#curriculum-name').inputValue(),'田﨑');
  assert.equal(writes.length,1);
  await page.locator('#open-curriculum-search-modal').click();
  await page.locator('#student-lesson-kind').selectOption('');
  await page.locator('#curriculum-search-modal-close').click();
  await page.locator('[data-student-group="代官山 · 集団"]').click();
  assert.equal(await page.locator('#student-selector button').innerText(),'集団 英語');
  await page.locator('[data-student-group="TOMAS"]').click();
  assert.equal(await page.locator('#student-selector button').count(),13);
  assert(await page.locator('#student-selector').evaluate(el=>el.scrollWidth>el.clientWidth));
  await page.screenshot({path:'/tmp/works-students-mobile-light.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:'/tmp/works-students-mobile-dark.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'/tmp/works-students-desktop-dark.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS: grouping, exact glyph identity, calendar_tag label, stored memo/print name, write payload, term filter, mobile overflow, light/dark renders');
})().catch(e=>{console.error(e);process.exit(1)});
