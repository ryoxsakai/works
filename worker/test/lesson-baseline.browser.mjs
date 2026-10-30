import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createFixture} from './next-lesson-fixture.mjs';
import {activationSql} from '../scripts/prepare-lesson-attribution-config.mjs';
const fixture=await createFixture();
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:390,height:900}});
const row=id=>page.locator(`#record-tbody tr[data-event-id="${id}"]`);
try {
 await fixture.DB.prepare('DELETE FROM lesson_record_identity').run(); // Synthetic fixtures only.
 const held={...fixture.events[0],id:'held-instance',summary:'Known Synthetic Replacement'};fixture.events.push(held);
 await fixture.DB.prepare("INSERT INTO curriculum_entries(calendar_event_id,lesson_plan)VALUES('held-instance','private held source')").run();
 const sql=activationSql({effective_date:'2026-10-27',holds:[{event_id:held.id,calendar_id:held.calendar_id,reason:'known_title_change'}]});
 await fixture.DB.batch(sql.split('\n').filter(line=>line&&!line.startsWith('--')).map(line=>fixture.DB.prepare(line)));
 await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());
 await page.goto(fixture.base+'/tutor/');await page.locator('[data-page-tab="record"]').click();
 await expect(row('b').locator('.record-plan')).toHaveValue('既存の次回予定');await expect(row('b')).not.toContainText('旧記録・所属未確認');await expect(page.locator('.legacy-record-notice')).toHaveCount(0);
 await expect(row('a').locator('.record-next-plan textarea')).toHaveValue('既存の次回予定');
 assert.equal((await fixture.DB.prepare("SELECT title FROM lesson_record_identity WHERE event_id='b'").first()).title,null);
 assert.equal((await fixture.DB.prepare("SELECT title FROM lesson_record_baseline WHERE event_id='b'").first()).title,'サンプル生徒');
 const heldRow=page.locator('#record-tbody tr').filter({hasText:'Known Synthetic Replacement'});
 await expect(heldRow).toContainText('既に予定名が変更された');assert.equal(await heldRow.locator('textarea').count(),0);
 assert.equal(await fixture.DB.prepare("SELECT * FROM lesson_record_baseline WHERE event_id='held-instance'").first(),null);
 assert.equal(await page.locator('#record-tbody').innerText().then(text=>text.includes('private held source')),false);
 // Current title baseline is a comparison only: even an ordinary legacy save keeps NULL owner title.
 await expect(row('b').locator('.record-homework')).toBeHidden();
 await row('b').locator('.record-homework').evaluate(el=>{el.value='edited legacy homework';el.dispatchEvent(new Event('change',{bubbles:true}));});
 await expect.poll(async()=> (await fixture.DB.prepare("SELECT homework FROM curriculum_entries WHERE calendar_event_id='b'").first()).homework).toBe('edited legacy homework');
 assert.equal((await fixture.DB.prepare("SELECT title FROM lesson_record_identity WHERE event_id='b'").first()).title,null);
 assert.equal(JSON.parse((await fixture.DB.prepare("SELECT snapshot_json FROM lesson_record_legacy_source WHERE event_id='b'").first()).snapshot_json).homework,'既存宿題');
 // Exercise the real UI loop against bounded, paced pages and partial failure.
 const initializationCalls=[];let interrupt=false;
 await page.route('**/api/lesson-baseline/initialize',async route=>{
   const body=route.request().postDataJSON();initializationCalls.push({body,at:Date.now()});
   assert.equal(body.limit,undefined);
   await route.fulfill({json:{effective_date:'2026-10-27',inspected:1,observed:1,historical:0,unavailable:0,collisions:0,held:1,
     ownership_verified:false,done:!!body.cursor,next_cursor:body.cursor||'page-one',retry_required:interrupt,retry_after_ms:1000}});
 });
 await page.locator('#open-settings').click();await page.locator('#initialize-lesson-baselines').click();
 await expect(page.locator('#lesson-baseline-progress')).toContainText('準備しました');
 assert.equal(initializationCalls.length,2);assert.ok(initializationCalls[1].at-initializationCalls[0].at>=950);
 assert.equal(initializationCalls[1].body.cursor,'page-one');
 interrupt=true;await page.locator('#initialize-lesson-baselines').click();
 await expect(page.locator('#lesson-baseline-progress')).toContainText('時間をおいて再試行');
 assert.equal(initializationCalls.length,3);assert.equal(initializationCalls[2].body.cursor,'');
 await expect(page.locator('#initialize-lesson-baselines')).toBeEnabled();
 await page.keyboard.press('Escape');
 fixture.events.find(event=>event.id==='b').summary='Future Synthetic Replacement';
 await page.reload();const changed=page.locator('#record-tbody tr').filter({hasText:'Future Synthetic Replacement'});
 await expect(changed).toContainText('比較開始時に観測した予定名');assert.equal(await changed.locator('textarea').count(),0);
 await changed.getByRole('button',{name:'旧記録を確認して対応を選ぶ'}).click();
 const dialog=page.getByRole('dialog',{name:'授業記録の対応を確認'});await expect(dialog).toContainText('比較開始時の観測名（所属未確認）');
 await dialog.getByText('観測・編集を始める前の原記録（所属未確認）').click();await expect(dialog).toContainText('既存宿題');
 await mkdir(new URL('../test-artifacts/lesson-baseline/',import.meta.url),{recursive:true});
 for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:new URL(`../test-artifacts/lesson-baseline/${width}.png`,import.meta.url).pathname});}
 console.log('PASS prospective baseline: retained legacy fields/notices, no owner verification on observation/edit, source retention, known hold, initial sweep action and future change review at 320/390/1280px');
}finally{await browser.close();await fixture.close();}
