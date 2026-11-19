const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r;}); return {promise,resolve}; };
(async()=>{
  const browser = await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
  const failures=[];
  async function scenario(title,check,config={}) {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-16T12:00:00Z'));
    const prefs={田崎:{print_name:'旧印刷氏名',memo:'既存メモ'},青木:{print_name:'青木の氏名'}};
    const puts=[]; const order=[]; const errors=[];
    let gate=null; let hiddenSchedule=false;
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('works_curriculum_state',JSON.stringify({name:'田崎',group:'代官山 · 個別',yearId:'1',termId:'1'})));
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url());
      const json=body=>route.fulfill({json:body});
      if(u.pathname==='/shared/auth.js') return route.fulfill({contentType:'text/javascript',body:`export const getSessionToken=()=>"test"; export const getGoogleAccessToken=async()=>"test"; export const signIn=()=>{}; export const signOutUser=()=>{}; export const isStandaloneHomeScreenApp=()=>false; export const watchAuth=({onSignedIn})=>setTimeout(()=>onSignedIn({email:"test@example.com"}),0);`});
      if(u.hostname==='www.googleapis.com') {
        if(u.pathname.endsWith('/calendarList')) return json({items:[{id:'d',summary:'代官山'},{id:'t',summary:'TOMAS'}]});
        const id=decodeURIComponent(u.pathname.split('/')[4]);
        if(config.hideT && id==='t' && !hiddenSchedule) {hiddenSchedule=true;return json({items:[]});}
        return json({items:(id==='d'?['田崎','青木']:['田崎']).map((summary,i)=>({id:id+i,summary,start:{dateTime:'2026-10-16T10:00:00Z'},end:{dateTime:'2026-10-16T11:00:00Z'}}))});
      }
      if(u.pathname==='/api/student-prefs') {
        if(route.request().method()==='PUT') {
          const body=JSON.parse(route.request().postData()); puts.push(body); order.push('PUT start');
          const current=gate; gate=null;
          current?.started.resolve();
          if(current) await current.release.promise;
          if(current?.fail) { order.push('PUT failed'); return route.fulfill({status:503,body:'fixture save failure'}); }
          prefs[body.name]={...prefs[body.name],...body}; order.push('PUT committed');
          return json(prefs[body.name]);
        }
        order.push('GET '+u.searchParams.get('name'));
        return json(prefs[u.searchParams.get('name')]||{});
      }
      if(u.pathname.startsWith('/api/')) {
        const data={'/api/settings':{selected_calendars:['d','t'],selected_term_ids:[1]},'/api/years':[{id:1,label:'2026'}],'/api/terms':[{id:1,year_id:1,label:'後期',start_date:'2026-10-01',end_date:'2026-12-31'}]};
        return json(data[u.pathname]||[]);
      }
      if(u.hostname==='localhost') {
        const file=path.join(process.cwd(),u.pathname);
        return fs.existsSync(file)&&fs.statSync(file).isFile()?route.fulfill({path:file}):route.fulfill({status:404,body:''});
      }
      return route.abort();
    });
    const settle=()=>page.waitForFunction(()=>document.querySelector('#student-selector').getAttribute('aria-busy')==='false' && document.querySelector('#curriculum-print-name').disabled===false);
    const holdSave=(fail=false)=>{const next={started:deferred(),release:deferred(),fail}; gate=next;return next;};
    try {
      await page.goto('http://localhost/tutor/index.html');
      await settle();
      await page.locator('[data-page-tab="curriculum"]').click();
      await check({page,settle,holdSave,prefs,puts,order});
      assert.deepEqual(errors,[]);
      console.log('PASS:',title);
    } catch(e) { failures.push(title); console.error('FAIL:',title,e.message); }
    finally {gate?.release.resolve();await context.close();}
  }
  await scenario('record link uses source classroom for duplicate names',async({page,settle})=>{
    for (const [calendar,group] of [['t','TOMAS'],['d','代官山 · 個別']]) {
      await page.locator('[data-page-tab="record"]').click();
      await page.locator(`#record-tbody [data-event-id="${calendar}0"] .record-student-link`).click();
      await settle();
      assert.equal(await page.locator(`[data-student-group="${group}"]`).getAttribute('aria-pressed'),'true');
      assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(el=>el.dataset.eventId)),[calendar+'0']);
      await page.screenshot({path:`/tmp/works-source-classroom-${calendar}.png`,fullPage:true});
    }
  });
  await scenario('record source survives a missing schedule-period candidate',async({page,settle})=>{
    await page.locator('[data-page-tab="record"]').click();
    await page.locator('#record-tbody [data-event-id="t0"] .record-student-link').click();
    await settle();
    assert.equal(await page.locator('[data-student-group="TOMAS"]').getAttribute('aria-pressed'),'true');
    await page.locator('#open-curriculum-search-modal').click();
    await page.locator('#curriculum-filter-form button[type="submit"]').click();
    await settle();
    assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(el=>el.dataset.eventId)),['t0']);
  },{hideT:true});
  for (const view of ['list','calendar']) await scenario(`${view} schedule link uses source classroom`,async({page,settle})=>{
    for (const [calendar,group] of [['t','TOMAS'],['d','代官山 · 個別']]) {
      await page.locator('[data-page-tab="schedule"]').click();
      await page.locator(`[data-view="${view}"]`).click();
      await page.locator(`.name-token-text[data-calendar-id="${calendar}"][data-token="田崎"]`).filter({visible:true}).click();
      await settle();
      assert.equal(await page.locator(`[data-student-group="${group}"]`).getAttribute('aria-pressed'),'true');
      assert.deepEqual(await page.locator('#curriculum-tbody tr[data-event-id]').evaluateAll(rows=>rows.map(el=>el.dataset.eventId)),[calendar+'0']);
    }
  });
  await scenario('display waits for print-name autosave before GET',async({page,settle,holdSave,order,prefs})=>{
    await page.locator('#open-curriculum-search-modal').click();
    const save=holdSave();
    await page.locator('#curriculum-print-name').fill('新しい印刷氏名');
    const readWhileSaving = page.waitForResponse(r=>new URL(r.url()).pathname==='/api/student-prefs' && r.request().method()==='GET',{timeout:300}).catch(()=>null);
    await page.locator('#curriculum-filter-form button[type="submit"]').click();
    await save.started.promise;
    await readWhileSaving;
    save.release.resolve();
    await settle();
    // Observe request ordering, not wall-clock timing: GET may only follow server commit.
    const start=order.lastIndexOf('PUT start');
    const commit=order.indexOf('PUT committed',start);
    assert(commit>start);
    assert.equal(order.slice(start,commit).some(entry=>entry==='GET 田崎'),false);
    assert.equal(prefs.田崎.print_name,'新しい印刷氏名');
    assert.equal(await page.locator('#curriculum-print-name').inputValue(),'新しい印刷氏名');
    await page.locator('#open-curriculum-search-modal').click();
    await page.screenshot({path:'/tmp/works-print-save-complete.png'});
  });
  await scenario('failed autosave blocks stale refresh and allows explicit retry',async({page,settle,holdSave,prefs,order})=>{
    await page.locator('#open-curriculum-search-modal').click();
    const save=holdSave(true);
    await page.locator('#curriculum-print-name').fill('保存失敗する氏名');
    await page.locator('#curriculum-filter-form button[type="submit"]').click();
    await save.started.promise;
    save.release.resolve();
    await page.waitForFunction(()=>document.querySelector('#action-error').textContent.includes('fixture save failure'));
    assert.equal(await page.locator('#curriculum-print-name').isDisabled(),true);
    assert.equal(await page.locator('#curriculum-search-modal').evaluate(el=>el.open),true);
    assert.equal(prefs.田崎.print_name,'旧印刷氏名');
    const start=order.lastIndexOf('PUT start');
    assert.equal(order.slice(start).some(entry=>entry==='GET 田崎'),false);
    await page.locator('#curriculum-filter-form button[type="submit"]').click();
    await settle();
    assert.equal(await page.locator('#curriculum-print-name').inputValue(),'旧印刷氏名');
  });
  await scenario('successive print edits persist in order before display',async({page,settle,holdSave,prefs,puts,order})=>{
    await page.locator('#open-curriculum-search-modal').click();
    const first=holdSave();
    await page.locator('#curriculum-print-name').fill('第一の氏名');
    await page.locator('#curriculum-term-select').focus();
    await first.started.promise;
    const second=holdSave();
    await page.locator('#curriculum-print-name').fill('第二の氏名');
    await page.locator('#curriculum-filter-form button[type="submit"]').click();
    assert.equal(puts.length,1);
    first.release.resolve();
    await second.started.promise;
    assert(order.lastIndexOf('PUT start')>order.indexOf('PUT committed'));
    second.release.resolve();
    await settle();
    assert.equal(prefs.田崎.print_name,'第二の氏名');
    assert.equal(await page.locator('#curriculum-print-name').inputValue(),'第二の氏名');
    assert.deepEqual(puts.map(body=>body.name),['田崎','田崎']);
  });
  await browser.close();
  if(failures.length) process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
