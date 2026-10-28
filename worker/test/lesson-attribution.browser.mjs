import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createFixture} from './next-lesson-fixture.mjs';
const fixture=await createFixture();
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:390,height:900}});
const record=id=>page.locator(`#record-tbody tr[data-event-id="${id}"]`);
try {
  await page.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.continue():route.abort());
  fixture.events.find(e=>e.id==='b').summary='新生徒サンプル';
  await page.goto(fixture.base+'/tutor/');await page.locator('[data-page-tab="record"]').click();
  const pending=page.locator('#record-tbody tr').filter({hasText:'新生徒サンプル'});
  await expect(pending).toContainText('確認済みの予定名');
  assert.equal(await pending.locator('textarea').count(),0);
  await pending.getByRole('button',{name:'旧記録を確認して対応を選ぶ'}).click();
  const dialog=page.getByRole('dialog',{name:'授業記録の対応を確認'});
  await expect(dialog).toContainText('現在の予定: 新生徒サンプル');await expect(dialog).toContainText('既存の次回予定');
  for(const width of [320,390,1280]) {
    await page.setViewportSize({width,height:900});
    assert.ok(await dialog.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
    const buttons=await dialog.locator('button').evaluateAll(items=>items.map(el=>({height:el.getBoundingClientRect().height,label:el.textContent})));
    assert.ok(buttons.every(b=>b.height>=44));
    await mkdir(new URL('../test-artifacts/lesson-attribution/',import.meta.url),{recursive:true});
    await page.screenshot({path:new URL(`../test-artifacts/lesson-attribution/${width}.png`,import.meta.url).pathname});
  }
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
  assert.equal((await fixture.DB.prepare('SELECT COUNT(*) AS n FROM lesson_record_archive').first()).n,0);
  await pending.getByRole('button',{name:'旧記録を確認して対応を選ぶ'}).focus();await page.keyboard.press('Enter');
  await dialog.getByRole('button',{name:'別の生徒への入れ替え：空の記録で始める'}).click();
  await expect(record('b').locator('.record-plan')).toHaveValue('');
  assert.equal((await fixture.DB.prepare("SELECT homework FROM curriculum_entries WHERE calendar_event_id='b'").first()).homework,null);
  const old=await fixture.DB.prepare('SELECT * FROM lesson_record_archive').first();assert.equal(JSON.parse(old.snapshot_json).lesson_plan,'既存の次回予定');
  await record('b').locator('.record-plan').fill('新しい生徒の予定');await record('b').locator('.record-plan').press('Tab');
  await expect(record('b').locator('.lesson-plan-status').first()).toHaveText('保存済み');
  await page.reload();await expect(record('b').locator('.record-plan')).toHaveValue('新しい生徒の予定');
  await expect(page.getByRole('button',{name:'記録の対応・履歴'})).toHaveCount(0);
  // Legacy source remains available and explicitly unverified, without blanket quarantine.
  await fixture.DB.prepare("UPDATE lesson_record_identity SET title=NULL,calendar_id=NULL,revision=revision+1 WHERE event_id='b'").run();
  await page.reload();await expect(record('b')).not.toContainText('旧記録・所属未確認');await expect(page.locator('.legacy-record-notice')).toHaveCount(0);
  await expect(record('b').locator('.record-plan')).toHaveValue('新しい生徒の予定');
  await expect(page.getByRole('button',{name:'記録の対応・履歴'})).toHaveCount(0);
  const baselineEvent=fixture.events.find(e=>e.id==='b');
  await fixture.DB.prepare('INSERT INTO lesson_record_baseline(event_id,calendar_id,title,effective_date)VALUES(?,?,?,?)').bind('b',baselineEvent.calendar_id,baselineEvent.summary,'2026-10-27').run();
  baselineEvent.summary='名前修正サンプル';
  await page.reload();
  await page.getByRole('button',{name:'旧記録を確認して対応を選ぶ'}).click();
  await expect(dialog).toContainText('不明（旧形式）');
  await dialog.getByRole('button',{name:'同じ生徒の名前修正：記録を引き継ぐ'}).click();
  await expect(record('b').locator('.record-plan')).toHaveValue('新しい生徒の予定');
  await expect(page.getByRole('button',{name:'記録の対応・履歴'})).toHaveCount(0);
  fixture.events.find(e=>e.id==='b').summary='再変更サンプル';
  await page.reload();
  await page.getByRole('button',{name:'旧記録を確認して対応を選ぶ'}).click();
  await dialog.getByText('保存された旧記録の履歴（2件）').click();await expect(dialog).toContainText('既存の次回予定');
  console.log('PASS title attribution: masked replacement, explicit old content, keyboard cancel/confirm, archive, separate/inherit, reload, legacy unknown and 320/390/1280px accessibility');
} finally {await browser.close();await fixture.close();}
