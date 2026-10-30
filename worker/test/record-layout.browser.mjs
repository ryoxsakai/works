import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createFixture} from './next-lesson-fixture.mjs';
const f=await createFixture(),browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||undefined});
const out=new URL('../test-artifacts/record-layout/',import.meta.url);await mkdir(out,{recursive:true});
try {
 const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===f.base?r.continue():r.abort());
 await page.goto(f.base+'/tutor/');const row=id=>page.locator(`#record-tbody tr[data-event-id="${id}"]`),next=row('a').locator('.record-next-plan textarea');
 await expect(next).toHaveValue('既存の次回予定');
 for(const width of [320,390,768,1440])for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:900});await page.evaluate(async t=>(await import('/shared/theme.js?v=6')).setTheme(t),theme);
  for(const cls of ['record-test','record-homework','record-memo'])await expect(row('b').locator('.'+cls)).toBeHidden();
  await expect(row('b').locator('.record-homework')).toHaveValue('既存宿題');await expect(row('b').locator('.record-memo')).toHaveValue('既存授業メモ');
  await expect(row('a').locator('.lesson-plan-target')).toBeHidden();await expect(row('a').locator('.record-recheck')).toBeEnabled();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`${width}-${theme}.png`,out).pathname});
 }
 await next.fill('新しい次回予定');await next.press('Tab');
 const toast=page.locator('.record-save-toast').filter({hasText:'次回授業予定: 保存済み'});await expect(toast).toBeVisible();
 const saved=await f.DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first();assert.equal(saved.homework,'既存宿題');assert.equal(saved.lesson_memo,'既存授業メモ');
 await page.waitForTimeout(2300);await next.fill('続けて保存');await next.press('Tab');await expect(toast).toBeVisible();await page.waitForTimeout(2000);await expect(toast).toBeVisible();await expect(toast).toHaveCount(0,{timeout:3500});
 f.control.failSave=true;await next.fill('失敗した入力');await next.press('Tab');await expect(row('a').locator('.record-next-plan .lesson-plan-status')).toContainText('保存できません');await expect(row('a').locator('.record-next-plan .lesson-plan-status')).toBeVisible();await expect(next).toHaveValue('失敗した入力');
 await row('a').getByRole('button',{name:'再保存',exact:true}).click();await expect(toast).toBeVisible();
 await f.DB.prepare("UPDATE curriculum_entries SET lesson_plan='別の編集' WHERE calendar_event_id='b'").run();await next.fill('競合入力');await next.press('Tab');await expect(row('a').locator('.record-next-plan .lesson-plan-status')).toContainText('保存を停止');await expect(next).toHaveValue('競合入力');await expect(row('a').getByRole('button',{name:'入力を破棄して予定を再確認',exact:true})).toBeVisible();await expect(row('a').locator('.record-recheck')).toBeDisabled();await expect(toast).toHaveCount(0);
 await page.emulateMedia({media:'print'});await expect(page.locator('.record-save-toasts')).toBeHidden();await expect(row('b').locator('.record-homework')).toBeHidden();await page.pdf({path:new URL('record.pdf',out).pathname});await page.emulateMedia({media:'screen'});
 await page.reload();await expect(next).toHaveValue('別の編集');await row('a').locator('.record-recheck').focus();await page.keyboard.press('Enter');await expect(next).toHaveValue('別の編集');
 assert.equal((await f.DB.prepare("SELECT homework FROM curriculum_entries WHERE calendar_event_id='b'").first()).homework,'既存宿題');
 console.log('PASS record layout: eight viewport/themes, retained hidden data, linked save, toast renewal/expiry, failure/CAS persistent gates, keyboard refresh, reload and print');
}finally{await browser.close();await f.close();}
