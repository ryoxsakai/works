import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultPeriodProfiles } from '../../shared/tutor-period-display.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://tutor-periods.test';
const auth = 'export const getSessionToken=()=>"synthetic"; export const getGoogleAccessToken=async()=>"synthetic"; export const signIn=()=>{}; export const signOutUser=()=>{}; export const isStandaloneHomeScreenApp=()=>false; export const watchAuth=({onSignedIn})=>setTimeout(()=>onSignedIn({email:"synthetic@example.invalid"}),0);';
const calendars = [
  {id:'cal-a',summary:'合成カレンダー甲',backgroundColor:'#245eab'},
  {id:'cal-b',summary:'合成カレンダー乙',backgroundColor:'#6b4bad'},
  {id:'cal-c',summary:'合成カレンダー丙',backgroundColor:'#a25b24'},
];
const day = '2026-11-21';
const rows = {
  'cal-a': [
    {id:'schedule-a',summary:'架空授業甲',start:{dateTime:day+'T09:45:00+09:00'},end:{dateTime:day+'T10:15:00+09:00'}},
    {id:'schedule-ad-hoc',summary:'架空の臨時授業',start:{dateTime:day+'T11:11:00+09:00'},end:{dateTime:day+'T12:15:00+09:00'}},
  ],
  'cal-b': [
    {id:'schedule-b',summary:'架空授業乙',start:{dateTime:day+'T09:45:00+09:00'},end:{dateTime:day+'T10:15:00+09:00'}},
  ],
  'cal-c': [],
};
const mime = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {});
try {
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:900}]) {
    const context=await browser.newContext({viewport, hasTouch:viewport.width<641, timezoneId:'Asia/Tokyo', reducedMotion:'reduce'});
    const page=await context.newPage();
    await page.clock.setFixedTime(new Date(day+'T12:30:00+09:00'));
    const errors=[], writes=[], unexpected=[];
    let saved, reply='success';
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*',async route=>{
      const request=route.request(), u=new URL(request.url());
      if(u.origin==='https://www.googleapis.com') {
        const items=u.pathname.endsWith('calendarList') ? calendars : rows[decodeURIComponent(u.pathname.split('/')[4])] || [];
        return route.fulfill({json:{items}});
      }
      if(u.origin!==origin) return route.abort();
      if(u.pathname==='/shared/auth.js') return route.fulfill({contentType:'text/javascript',body:auth});
      if(u.pathname==='/api/tutor-period-profiles') {
        assert.equal(request.method(),'PUT');
        const payload=request.postDataJSON();
        writes.push(payload);
        if(reply==='failure') return route.fulfill({status:503,json:{error:'synthetic save failure'}});
        if(reply==='stale-ack') return route.fulfill({json:{lesson_period_profiles:payload}});
        if(reply==='conflict') {
          saved={...structuredClone(saved),revision:saved.revision+1,common_mode:'both'};
          return route.fulfill({status:409,json:{error:'synthetic revision conflict'}});
        }
        assert.equal(payload.revision,saved?.revision??0);
        saved={...payload,revision:payload.revision+1};
        return route.fulfill({json:{lesson_period_profiles:saved}});
      }
      if(u.pathname.startsWith('/api/')) {
        const method=request.method();
        if (method!=='GET' && !(method==='POST'&&u.pathname==='/api/lesson-records')) unexpected.push({method,path:u.pathname});
        const data={
          '/api/settings':{selected_calendars:calendars.map(x=>x.id),selected_term_ids:[1],excluded_titles:[],...(saved?{lesson_period_profiles:saved}:{})},
          '/api/years':[{id:1,label:'合成年度'}],
          '/api/terms':[{id:1,year_id:1,label:'合成学期',start_date:'2026-01-01',end_date:'2026-12-31'}],
          '/api/periods':[{id:1,label:'共通1限',start_time:'09:30',sort_order:0}],
          '/api/todo':{tasks:[]},
          '/api/student-prefs':{memo:'',print_name:''},
        };
        return route.fulfill({json:data[u.pathname]||[]});
      }
      const file=path.join(root,u.pathname+(u.pathname.endsWith('/')?'index.html':''));
      const body=await readFile(file).catch(()=>null);
      return body ? route.fulfill({contentType:mime[path.extname(file)],body}) : route.fulfill({status:404,body:''});
    });

    await page.goto(origin+'/tutor/');
    const modal=page.getByRole('dialog',{name:'設定',exact:true});
    const open=page.locator('#open-settings');
    await open.click();
    const tabs=modal.getByRole('tablist',{name:'授業管理の設定項目'});
    const calendarTab=tabs.getByRole('tab',{name:'カレンダー'});
    await calendarTab.focus();
    await page.keyboard.press('ArrowRight');
    const periodsTab=tabs.getByRole('tab',{name:'時限'});
    await expect(periodsTab).toBeFocused();
    await expect(periodsTab).toHaveAttribute('aria-selected','true');
    const panel=modal.getByRole('tabpanel',{name:'時限'});
    const geometry=await panel.evaluate(node=>{
      const dialog=node.closest('dialog'), rect=dialog.getBoundingClientRect();
      const header=dialog.querySelector('.modal-header').getBoundingClientRect();
      node.scrollTop=node.scrollHeight;
      return {
        panelFits:node.scrollWidth<=node.clientWidth+1,
        contained:rect.left>=0&&rect.right<=innerWidth+1&&rect.top>=0&&rect.bottom<=innerHeight+1,
        tabFits:[...dialog.querySelectorAll('[role=tab]')].every(btn=>btn.scrollWidth<=btn.clientWidth+1&&btn.getBoundingClientRect().height>=36),
        fixedHeader:dialog.querySelector('.modal-header').getBoundingClientRect().top===header.top,
      };
    });
    assert.deepEqual(geometry,{panelFits:true,contained:true,tabFits:true,fixedHeader:true});
    const picker=panel.locator('#period-school');
    await expect(picker.locator('option')).toHaveText(['共通','TOMAS','代官山','淑徳与野']);
    await expect(panel.locator('#period-list')).toContainText('共通1限');
    await picker.selectOption('tomas');
    const entries=panel.locator('#period-school-entries');
    const choices=panel.locator('#period-calendar-choices');
    const submit=panel.locator('#period-profiles-save');
    const alert=panel.locator('#period-profiles-error');
    const mode=panel.locator('#period-display-mode');
    const add=panel.locator('#period-school-add');
    const row=rowsToIndex=>entries.locator('.period-school-row').nth(rowsToIndex);
    const label=i=>row(i).getByRole('textbox',{name:'時限名'});
    const start=i=>row(i).getByLabel('開始時刻');
    await choices.getByRole('checkbox',{name:'合成カレンダー甲',exact:true}).check();
    await mode.selectOption('both');
    for(const [i,minutes] of ['09:45','10:50'].entries()){
      await add.click();
      await label(i).fill('S限');
      await start(i).fill(minutes);
    }
    await picker.selectOption('daikanyama');
    await expect(choices.getByRole('checkbox',{name:/合成カレンダー甲/})).toBeDisabled();
    await choices.getByRole('checkbox',{name:'合成カレンダー乙',exact:true}).check();
    await add.click();
    await label(0).fill('第3講');
    await start(0).fill('09:45');
    await picker.selectOption('shukutoku_yono');
    await choices.getByRole('checkbox',{name:'合成カレンダー丙',exact:true}).check();
    await mode.selectOption('time');

    // Canceling the dialog preserves unsaved choices without any write.
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(open).toBeFocused();
    assert.equal(writes.length,0);
    await open.click();
    await picker.selectOption('tomas');
    await expect(label(0)).toHaveValue('S限');
    await expect(start(1)).toHaveValue('10:50');
    await start(1).fill('09:45');
    await submit.click();
    await expect(alert).toContainText('重複');
    assert.equal(writes.length,0);
    await start(1).fill('10:50');

    reply='failure';
    await submit.click();
    await expect(alert).toContainText('入力は保持');
    await expect(label(0)).toHaveValue('S限');
    await expect(choices.getByRole('checkbox',{name:'合成カレンダー甲',exact:true})).toBeChecked();
    assert.equal(writes.length,1);
    assert.equal(saved,undefined);
    reply='success';
    await submit.click();
    await expect(panel.locator('#period-profiles-status')).toContainText('保存しました');
    assert.deepEqual(writes[1],writes[0]);
    assert.deepEqual(saved.schools.tomas.calendar_ids,['cal-a']);
    assert.deepEqual(saved.schools.tomas.periods,[{label:'S限',start_time:'09:45'},{label:'S限',start_time:'10:50'}]);
    assert.deepEqual(saved.schools.daikanyama.calendar_ids,['cal-b']);
    assert.equal(saved.schools.shukutoku_yono.mode,'time');
    await page.keyboard.press('Escape');
    // Already displayed cards update in place without new writes or losing inputs.
    await expect(page.locator('#record-tbody tr[data-event-id="schedule-a"] [data-label="時刻"]')).toHaveText('S限（09:45）');
    await expect(page.locator('#record-tbody tr[data-event-id="schedule-b"] [data-label="時刻"]')).toHaveText('第3講');
    await expect(page.locator('#record-tbody tr[data-event-id="schedule-ad-hoc"] [data-label="時刻"]')).toHaveText('11:11');
    await page.locator('[data-page-tab="schedule"]').click();
    await expect(page.locator('#event-list [data-lesson-period="list"][data-period-calendar="cal-a"]').first()).toContainText('S限');

    await open.click();
    await picker.selectOption('tomas');
    await label(0).fill('A限');
    reply='conflict';
    await submit.click();
    await expect(alert).toContainText('別の画面');
    await expect(label(0)).toHaveValue('A限');
    await expect(submit).toBeDisabled();
    const reload=panel.locator('#period-profiles-reload');
    page.once('dialog',d=>d.dismiss());
    await reload.click();
    await expect(label(0)).toHaveValue('A限');
    page.once('dialog',d=>d.accept());
    await reload.click();
    await expect(label(0)).toHaveValue('S限');
    await picker.selectOption('common');
    await expect(mode).toHaveValue('both');

    reply='stale-ack';
    await mode.selectOption('time');
    await submit.click();
    await expect(alert).toContainText('保存結果を確認できません');
    await expect(mode).toHaveValue('time');
    await expect(submit).toBeDisabled();
    assert.equal(writes.length,4);
    await page.reload();
    await open.click();
    await modal.getByRole('tab',{name:'時限',exact:true}).click();
    await expect(mode).toHaveValue('both');
    // The public entry now resumes the teaching service, not the retired home cards.
    await page.evaluate(() => {
      localStorage.setItem('works_session_token', 'synthetic');
      localStorage.setItem('works_last_service', '/tutor/');
    });
    await page.goto(origin+'/');
    await expect(page).toHaveURL(origin+'/tutor/');
    const service=viewport.width<=730 ? page.frameLocator('iframe.works-service-frame:not([aria-hidden])') : page;
    await service.locator('[data-page-tab="record"]').click();
    await expect(service.locator('#record-tbody tr[data-event-id="schedule-a"] [data-label="時刻"]')).toHaveText('S限（09:45）');
    await expect(service.locator('#record-tbody tr[data-event-id="schedule-ad-hoc"] [data-label="時刻"]')).toHaveText('11:11');
    assert.equal(writes.length,4);
    assert.deepEqual(errors,[]);
    assert.deepEqual(unexpected,[]);
    await context.close();
  }
  console.log('School-specific periods: desktop/mobile settings, secure persistence, exclusive calendars, validation, failure/conflict retention, record/schedule display after entry resume PASS');
} finally {
  await browser.close();
}
