import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createFixture} from './next-lesson-fixture.mjs';
import {parseCalendarRecord,parsePlainCalendarRecord} from '../../shared/calendar-lesson-record.mjs';
const parseVisible=(description='')=>parseCalendarRecord(description)||parsePlainCalendarRecord(description,{calendar_id:'synthetic-calendar',event_id:'b',title:'合成生徒',generation:0});
const fixture=await createFixture(0,{calendarRecords:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:390,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
const row=id=>page.locator(`#record-tbody tr[data-event-id="${id}"]`),field=id=>row(id).locator('.record-plan');
try{
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin==='https://www.googleapis.com'){const proxy=u.pathname.endsWith('calendarList')?'/qa-calendars':'/qa-events?'+u.searchParams.toString()+'&calendar='+encodeURIComponent(decodeURIComponent(u.pathname.split('/')[4]));return route.fulfill({response:await route.fetch({url:fixture.base+proxy})});}return u.origin===fixture.base?route.continue():route.abort();});
 await page.goto(fixture.base+'/tutor/');await page.locator('[data-page-tab="record"]').click();
 await expect(field('b')).toHaveValue('既存の次回予定');
 await expect.poll(()=>fixture.control.initializations).toBe(1);
 await expect.poll(()=>parseVisible(fixture.events.find(e=>e.id==='template-target').description)?.values.lesson_plan).toBe('');
 for(const value of ['カレンダーへ保存\n第二行','続けて保存']){
  await field('b').fill(value);await field('b').press('Tab');
  await expect(row('b').locator('.lesson-plan-status').first()).toHaveText('保存済み');
  await expect(row('a').locator('.record-next-plan textarea')).toHaveValue(value);
  assert.equal(parseVisible(fixture.events.find(e=>e.id==='b').description).values.lesson_plan,value);
 }
 assert.equal(fixture.control.calendarWrites.filter(w=>w.id==='b').length,2);
 assert.equal(parseVisible(fixture.events.find(e=>e.id==='b').description).values.homework,'既存宿題');
 const memobefore=await fixture.DB.prepare("SELECT memo FROM student_prefs WHERE name='サンプル生徒'").first();
 assert.equal(memobefore.memo,'既存の生徒メモ');
 await page.reload();await expect(field('b')).toHaveValue('続けて保存');assert.equal(fixture.control.initializations,1);
 // Root uses the same service/controller and shows the exact Calendar value.
 await page.goto(fixture.base+'/');await expect(page.locator('.home-lesson-cards .record-plan').filter({hasText:'never'})).toHaveCount(0);
 const home=page.locator('.home-lesson-cards tr[data-event-id="b"] .record-plan');await expect(home).toHaveValue('続けて保存');
 await home.fill('トップからの保存');await home.press('Tab');
 await expect.poll(()=>parseVisible(fixture.events.find(e=>e.id==='b').description).values.lesson_plan).toBe('トップからの保存');
 assert.equal(fixture.control.calendarWrites.filter(w=>w.id==='b').length,3);
 await page.goto(fixture.base+'/tutor/');await expect(field('b')).toHaveValue('トップからの保存');assert.equal(fixture.control.initializations,1);
 await page.goto(fixture.base+'/');const rootField=page.locator('.home-lesson-cards tr[data-event-id="b"] .record-plan');await expect(rootField).toHaveValue('トップからの保存');
 const artifacts=new URL('../test-artifacts/calendar-lesson-cards/',import.meta.url);await mkdir(artifacts,{recursive:true});
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(250);await page.screenshot({path:new URL(`home-${width}.png`,artifacts).pathname});}
 await page.setViewportSize({width:390,height:900});
 fixture.control.calendarLost=true;await rootField.fill('応答不明の保存');await rootField.press('Tab');
 await expect.poll(async()=>(await fixture.DB.prepare("SELECT status FROM calendar_lesson_migration WHERE event_id='b' ORDER BY rowid DESC LIMIT 1").first())?.status).toBe('unknown');
 await expect(rootField).toHaveValue('応答不明の保存');const patchCount=fixture.control.calendarWrites.length;
 page.once('dialog',dialog=>dialog.accept());await page.reload();const reconcile=page.locator('.home-lesson-cards .calendar-record-reconcile');await expect(reconcile).toHaveCount(1);
 for(let i=0;i<6&&!await reconcile.isVisible();i++){await page.getByRole('button',{name:'次の授業カード',exact:true}).click();await page.waitForTimeout(250);}
 await expect(reconcile).toBeVisible();await reconcile.click();await expect(page.locator('.home-lesson-cards tr[data-event-id="b"] .record-plan')).toHaveValue('応答不明の保存');assert.equal(fixture.control.calendarWrites.length,patchCount);
 assert.deepEqual(errors,[]);assert.ok(fixture.events.filter(e=>['b','template-target'].includes(e.id)).every(e=>!e.description.includes('<!--')));
 console.log('PASS Calendar original Tutor + home: four fields retained, native editor/next link, repeated ETags, explicit empty-instance initialization once, root roundtrip, no memo migration');
}finally{await browser.close();await fixture.close();}
