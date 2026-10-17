const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium', args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors=[]; const writes=[]; let failPath = ""; let pendingDelay = null; let raceProfiles = false;
  page.on('pageerror', e=>errors.push(e.message));
  const calendars=[{id:'d',summary:'代官山'},{id:'t',summary:'TOMAS'}];
  const events={d:['田﨑','田崎','田崎(振替)','田崎/英語','田崎（振替）','集団 英語','A6 Basic','M3 High','A5Ba','M3High','A6Basic','会議','WT作成','会議（講師）','WT作成/準備'],t:['青木','田崎',...Array.from({length:12},(_,i)=>`生徒${i}`),'会議','WT作成']};
  await page.route('**/*', async route=>{
    const u=new URL(route.request().url());
    const json=body=>route.fulfill({json:body});
    if (pendingDelay?.match(u, route.request())) {
      const delay = pendingDelay;
      pendingDelay = null;
      delay.started();
      await delay.gate;
      if (delay.fail) return route.fulfill({status:503,body:'stale fixture failure'});
    }
    if(u.pathname==='/shared/auth.js') return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=>"test"; export const getGoogleAccessToken=async()=>"test"; export const signIn=()=>{}; export const signOutUser=()=>{}; export const isStandaloneHomeScreenApp=()=>false; export const watchAuth=({onSignedIn})=>setTimeout(()=>onSignedIn({email:"test@example.com"}),0);`});
    if(u.hostname==='www.googleapis.com') {
      if(u.pathname.endsWith('/calendarList')) return json({items:calendars});
      const id=decodeURIComponent(u.pathname.split('/')[4]);
      return json({items:(events[id]||[]).map((name,i)=>({id:id+i,summary:name,start:{dateTime:'2026-10-16T10:00:00Z'},end:{dateTime:'2026-10-16T11:00:00Z'}}))});
    }
    if(u.pathname.startsWith('/api/')) {
      if(route.request().method()!=='GET') writes.push(JSON.parse(route.request().postData()));
      if (u.pathname === failPath) return route.fulfill({status:503,body:'fixture failure'});
      const data={'/api/settings':{selected_calendars:['d','t']},'/api/students':[{name:'田﨑 太郎',calendar_tag:'田﨑'}],'/api/years':[{id:1,label:'2026'}],'/api/terms':[{id:1,year_id:1,label:'後期',start_date:'2026-10-01',end_date:'2026-12-31'}],'/api/student-prefs':{print_name:'既存の印刷氏名',memo:'既存メモ'}};
      if (raceProfiles && u.pathname === '/api/student-prefs') return json({print_name:u.searchParams.get('name'),memo:u.searchParams.get('name')});
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
  assert.deepEqual((await page.locator('#student-selector button').allTextContents()).sort(),['田崎','田﨑 太郎田﨑'].sort());
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
  assert.deepEqual((await page.locator('#student-selector button').allTextContents()).sort(),['A5Ba','A6Basic','A6 Basic','M3High','M3 High','集団 英語'].sort());
  await page.locator('#student-selector button').filter({hasText:/^A6 Basic$/}).click();
  await page.waitForFunction(()=>document.querySelector('#student-selector').getAttribute('aria-busy')==='false');
  assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId)),['d6']);
  for (const [title,eventId] of [['A5Ba','d8'],['M3High','d9']]) {
    await page.locator('#student-selector button').filter({hasText:new RegExp(`^${title}$`)}).click();
    await page.waitForFunction(()=>document.querySelector('#student-selector').getAttribute('aria-busy')==='false');
    assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId)),[eventId]);
  }
  await page.screenshot({path:'/tmp/works-students-group-mobile-light.png',fullPage:true});
  await page.locator('[data-student-group="代官山 · 個別"]').click();
  assert.equal(await page.locator('#curriculum-name').inputValue(),'');
  assert.equal(await page.locator('#student-memo').inputValue(),'');
  await page.locator('#student-selector button').filter({hasText:/^田崎$/}).click();
  await page.waitForFunction(()=>document.querySelector('#student-selector').getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#student-selector button').filter({hasText:/^田崎$/}).count(),1);
  assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId)),['d1','d2','d3','d4']);
  await page.locator('[data-student-group="TOMAS"]').click();
  assert.equal(await page.locator('#curriculum-name').inputValue(),'');
  assert.equal(await page.locator('#curriculum-tbody tr').count(),0);
  await page.locator('#open-curriculum-search-modal').click();
  assert.equal(await page.locator('#curriculum-print-name').isDisabled(),true);
  await page.locator('#curriculum-filter-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#curriculum-search-modal').open);
  assert.equal(await page.locator('#curriculum-tbody tr').count(),0);
  assert.equal(await page.locator('[data-student-group="TOMAS"]').getAttribute('aria-pressed'),'true');
  const select = async (name) => {
    await page.locator('#student-selector button').filter({hasText:new RegExp(`^${name}$`)}).click();
    await page.waitForFunction(()=>document.querySelector('#student-selector').getAttribute('aria-busy')==='false');
  };
  await select('田崎');
  assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(row=>row.dataset.eventId)),['t1']);
  for (const path of ['/api/goals','/api/student-prefs','/api/student-materials']) {
    failPath = path;
    await select('青木');
    await page.locator('#open-curriculum-search-modal').click();
    assert.equal(await page.locator('#curriculum-print-name').inputValue(),'');
    assert.equal(await page.locator('#curriculum-print-name').isDisabled(),true);
    if (path === '/api/student-prefs') await page.screenshot({path:'/tmp/works-students-load-failure-mobile.png'});
    await page.locator('#curriculum-print-name').evaluate(el=>{el.value='旧生徒の名前';el.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(writes.length,1);
    await page.locator('#curriculum-search-modal-close').click();
    failPath = '';
    await select('田崎');
  }
  assert.equal(await page.locator('#student-selector button').count(),14);
  assert(await page.locator('#student-selector').evaluate(el=>el.scrollWidth>el.clientWidth));
  await page.screenshot({path:'/tmp/works-students-mobile-light.png',fullPage:true});
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:'/tmp/works-students-mobile-dark.png',fullPage:true});
  await page.setViewportSize({width:1280,height:900});
  await page.screenshot({path:'/tmp/works-students-desktop-dark.png',fullPage:true});
  // Hold real requests at each asynchronous boundary, then complete newer navigation.
  const holdNext = (match, fail=false) => {
    let started, release;
    const seen = new Promise(resolve=>{started=resolve;});
    const gate = new Promise(resolve=>{release=resolve;});
    pendingDelay = {match, fail, started, gate};
    return {seen, release};
  };
  const flush = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const state = () => page.evaluate(()=>({
    name:document.querySelector('#curriculum-name').value,
    pressed:[...document.querySelectorAll('#student-selector [aria-pressed=true]')].map(el=>el.textContent),
    rows:[...document.querySelectorAll('#curriculum-tbody tr[data-event-id]')].map(el=>el.dataset.eventId),
    memo:document.querySelector('#student-memo').value,
    print:document.querySelector('#curriculum-print-name').value,
    disabled:document.querySelector('#curriculum-print-name').disabled,
    busy:document.querySelector('#student-selector').getAttribute('aria-busy'),
    inert:[...document.querySelectorAll('[data-page-tab-panel=curriculum] .collapsible-section')].map(el=>el.inert),
    summary:document.querySelector('#curriculum-search-summary').textContent,
    error:document.querySelector('#action-error').textContent,
    modal:document.querySelector('#curriculum-search-modal').open
  }));
  await page.setViewportSize({width:390,height:844});
  raceProfiles = true;
  await page.locator('[data-student-group="代官山 · 個別"]').click();
  const boundaries = [
    u=>u.hostname==='www.googleapis.com' && u.pathname.includes('/calendars/d/events'),
    ...['/api/curriculum','/api/goals','/api/schools','/api/student-prefs','/api/student-materials'].map(path=>u=>u.pathname===path)
  ];
  for (const match of boundaries) for (const fail of [false,true]) {
    await select('田崎');
    const delayed = holdNext(match, fail);
    await page.locator('#open-curriculum-search-modal').click();
    await page.locator('#curriculum-filter-form button[type="submit"]').click();
    await delayed.seen;
    await page.locator('#curriculum-search-modal-close').click();
    await select('田﨑 太郎田﨑');
    const before = await state();
    assert.equal(before.name,'田﨑');
    assert.deepEqual(before.rows,['d0']);
    assert.equal(before.memo,'田﨑');
    // A late settings completion must not close a freshly opened settings modal.
    await page.locator('#open-curriculum-search-modal').click();
    const withModal = await state();
    const response = page.waitForResponse(r=>match(new URL(r.url())));
    delayed.release();
    await (await response).finished();
    await flush();
    assert.deepEqual(await state(),withModal);
    await page.locator('#curriculum-search-modal-close').click();
  }
  // An old completion may not release the newer operation's busy/editing lock.
  await select('田崎');
  const old = holdNext(u=>u.pathname==='/api/curriculum');
  await page.locator('#open-curriculum-search-modal').click();
  await page.locator('#curriculum-filter-form button[type="submit"]').click();
  await old.seen;
  await page.locator('#curriculum-search-modal-close').click();
  const newer = holdNext(u=>u.pathname==='/api/student-prefs');
  await page.locator('#student-selector button').filter({hasText:/^田﨑 太郎田﨑$/}).click();
  await newer.seen;
  const during = await state();
  assert.equal(during.busy,'true');
  assert.deepEqual(during.pressed,['田﨑 太郎田﨑']);
  assert.equal(during.disabled,true);
  await page.screenshot({path:'/tmp/works-students-race-loading-mobile.png',fullPage:true});
  const oldResponse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/curriculum');
  old.release();
  await (await oldResponse).finished();
  await flush();
  assert.deepEqual(await state(),during);
  // Supersede B as well, then release B after the final student's screen is ready.
  await select('田崎');
  const final = await state();
  const newResponse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/student-prefs');
  newer.release();
  await (await newResponse).finished();
  await flush();
  assert.deepEqual(await state(),final);
  await page.screenshot({path:'/tmp/works-students-race-settled-mobile.png',fullPage:true});
  // Returning to A still creates a new generation; A's original failure is stale.
  await select('田崎');
  const originalA = holdNext(u=>u.pathname==='/api/curriculum',true);
  await page.locator('#open-curriculum-search-modal').click();
  await page.locator('#curriculum-filter-form button[type="submit"]').click();
  await originalA.seen;
  await page.locator('#curriculum-search-modal-close').click();
  await select('田﨑 太郎田﨑');
  await select('田崎');
  const latestA = await state();
  const originalAResponse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/curriculum');
  originalA.release();
  await (await originalAResponse).finished();
  await flush();
  assert.deepEqual(await state(),latestA);
  // Initial restoration is another entry point and must lose ownership to navigation.
  await page.evaluate(()=>localStorage.setItem('works_curriculum_state',JSON.stringify({name:'田崎',group:'代官山 · 個別',yearId:'1',termId:'1'})));
  const initial = holdNext(u=>u.pathname==='/api/student-prefs', true);
  await page.reload();
  await initial.seen;
  await select('田﨑 太郎田﨑');
  const afterInitialSwitch = await state();
  const initialResponse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/student-prefs');
  initial.release();
  await (await initialResponse).finished();
  await flush();
  assert.deepEqual(await state(),afterInitialSwitch);
  // Delayed saves retain the original payload and cannot update/error the next student.
  for (const fail of [false,true]) {
    await select('田崎');
    await page.locator('#open-curriculum-search-modal').click();
    const save = holdNext((u,req)=>u.pathname==='/api/student-prefs' && req.method()==='PUT',fail);
    await page.locator('#curriculum-print-name').fill('田崎の印刷氏名');
    await page.locator('#curriculum-term-select').focus();
    await save.seen;
    await page.locator('#curriculum-search-modal-close').click();
    await select('田﨑 太郎田﨑');
    const afterSaveSwitch = await state();
    const saveResponse = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/student-prefs' && r.request().method()==='PUT');
    save.release();
    await (await saveResponse).finished();
    await flush();
    assert.deepEqual(await state(),afterSaveSwitch);
    if (!fail) assert.deepEqual(writes.at(-1),{name:'田崎',print_name:'田崎の印刷氏名'});
  }
  await page.evaluate(()=>localStorage.setItem('works_curriculum_state',JSON.stringify({name:'田崎(振替)',group:'代官山 · 個別',yearId:'1',termId:'1'})));
  await page.reload();
  await page.locator('#curriculum-tbody tr[data-event-id="d2"]').waitFor();
  assert.equal(await page.locator('#curriculum-name').inputValue(),'田崎(振替)');
  assert.equal(await page.locator('#student-selector button[aria-pressed="true"]').innerText(),'田崎(振替)');
  assert.equal(await page.locator('#curriculum-tbody tr[data-event-id]').count(),1);
  await page.evaluate(()=>localStorage.setItem('works_curriculum_state',JSON.stringify({name:'会議',group:'代官山 · 個別',yearId:'1',termId:'1'})));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#curriculum-print-name').value==='会議' && document.querySelector('#curriculum-print-name').disabled===false);
  assert.equal(await page.locator('#student-selector button').filter({hasText:/会議|WT作成/}).count(),0);
  assert.equal(await page.locator('#curriculum-tbody tr[data-event-id]').count(),0);
  assert.deepEqual(errors,[]);
  await browser.close();
  console.log('PASS: compact legacy class codes and administrative-event exclusion; standard UI regressions plus delayed success/failure at all six load boundaries, superseded busy ownership, consecutive switches, initial restore, delayed saves');
})().catch(e=>{console.error(e);process.exit(1)});
