import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createFixture} from './next-lesson-fixture.mjs';
const fixture=await createFixture();
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:390,height:900}});
const row=id=>page.locator(`#record-tbody tr[data-event-id="${id}"]`);
const next=id=>row(id).locator('.record-next-plan textarea');
const normal=id=>row(id).locator('.record-plan');
const status=id=>row(id).locator('.record-next-plan .lesson-plan-status');
const dbPlan=async id=>(await fixture.DB.prepare('SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id=?').bind(id).first())?.lesson_plan;
const save=async(field,value)=>{await field.fill(value);await field.press('Tab');};
try{
 await page.route('**/*',r=>new URL(r.request().url()).origin===fixture.base?r.continue():r.abort());
 await page.goto(fixture.base+'/tutor/');await page.locator('[data-page-tab="record"]').click();
 await expect(next('a')).toHaveValue('既存の次回予定');await expect(next('other')).toHaveValue('別教室の予定');
 assert.equal(fixture.control.writes.length,0,'reads never initialize or copy a plan');
 await expect(row('a').locator('.lesson-plan-target')).toContainText('11:00–12:00');
 await expect(status('none')).toContainText('366日');assert.equal(await next('none').isVisible(),false);
 const order=await row('a').locator('textarea').evaluateAll(els=>els.map(el=>el.className));
 assert.ok(order[3].includes('record-memo'));assert.ok(order[4].includes('linked-lesson-plan')); 
 assert.ok(order.at(-1).includes('student-memo-input'));
 await save(next('a'),'次回から変更\n二行目');await expect(status('a')).toHaveText('保存済み');
 await expect(normal('b')).toHaveValue('次回から変更\n二行目');assert.equal(await dbPlan('b'),'次回から変更\n二行目');assert.equal(await dbPlan('a'),undefined);
 await save(normal('b'),'当日から変更');await expect(next('a')).toHaveValue('当日から変更');
 await expect(row('b').locator('.lesson-plan-status').first()).toHaveText('保存済み');assert.equal(await dbPlan('b'),'当日から変更');
 await page.reload();await expect(next('a')).toHaveValue('当日から変更');await expect(next('other')).toHaveValue('別教室の予定');
 fixture.control.failSave=true;await save(next('a'),'失敗後の入力');await expect(status('a')).toContainText('保存できません');
 await expect(next('a')).toHaveValue('失敗後の入力');assert.equal(await dbPlan('b'),'当日から変更');
 await row('a').getByRole('button',{name:'再保存',exact:true}).click();await expect(status('a')).toHaveText('保存済み');assert.equal(await dbPlan('b'),'失敗後の入力');
 // An old acknowledgement is isolated to its fixed event while another date is visible.
 let release;fixture.control.holdSave=new Promise(resolve=>release=resolve);
 const count=fixture.control.writes.length;await save(next('a'),'遅延保存');
 await expect.poll(()=>fixture.control.writes.length).toBe(count+1);
 await page.locator('.record-day-btn[data-day="next"]').click();await expect(normal('other-next')).toHaveValue('別教室の予定');
 release();fixture.control.holdSave=null;await expect.poll(()=>dbPlan('b')).toBe('遅延保存');await expect(normal('other-next')).toHaveValue('別教室の予定');
 await page.locator('.record-day-btn[data-day="prev"]').click();await expect(next('a')).toHaveValue('遅延保存');
 // A cancelled next event is never silently replaced as the destination of a pending draft.
 fixture.events.find(e=>e.id==='b').status='cancelled';
 await save(next('a'),'予定変更後の入力');await expect(status('a')).toContainText('保存を停止');
 await expect(next('a')).toHaveValue('予定変更後の入力');assert.equal(await dbPlan('b'),'遅延保存');assert.equal(await dbPlan('c'),'次週の既存予定');
 await row('a').getByRole('button',{name:'入力を破棄して予定を再確認',exact:true}).click();await expect(next('a')).toHaveValue('次週の既存予定');
 // A different editor's persisted update is a CAS conflict, preserving this draft.
 await fixture.DB.prepare("UPDATE curriculum_entries SET lesson_plan='別画面で保存' WHERE calendar_event_id='c'").run();
 await save(next('a'),'競合中の入力');await expect(status('a')).toContainText('保存を停止');await expect(next('a')).toHaveValue('競合中の入力');assert.equal(await dbPlan('c'),'別画面で保存');
 await row('a').getByRole('button',{name:'入力を破棄して予定を再確認',exact:true}).click();await expect(next('a')).toHaveValue('別画面で保存');
 await mkdir(new URL('../test-artifacts/next-lesson/',import.meta.url),{recursive:true});
 for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:900});
  const geometry=await page.locator('body').evaluate(el=>({width:innerWidth,scroll:el.scrollWidth}));assert.ok(geometry.scroll<=width);
  await next('a').fill('');const empty=await next('a').evaluate(el=>el.offsetHeight);
  await next('a').fill('長い日本語の予定を折り返して表示します。'.repeat(40));assert.ok(await next('a').evaluate(el=>el.offsetHeight)>empty);assert.ok(await next('a').evaluate(el=>el.scrollHeight<=el.clientHeight));
  await next('a').fill('別画面で保存');await page.screenshot({path:new URL(`../test-artifacts/next-lesson/${width}.png`,import.meta.url).pathname,fullPage:true});
 }
 console.log('PASS linked next lesson: actual SQLite persistence, two-way editors, calendar isolation, no-next, retry, stale response, changed schedule, CAS and 320/390/1280px');
}finally{await browser.close();await fixture.close();}
