import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createFixture} from './next-lesson-fixture.mjs';
const fixture = await createFixture();
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {});
try {
 for (const width of [390,1280]) {
  const context = await browser.newContext({viewport:{width,height:840}});
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(7000);
  await page.route('**/*', r => new URL(r.request().url()).origin === fixture.base ? r.continue() : r.abort());
  page.on('pageerror', e => errors.push(e.message));
  const owners = ['one','two'].map(id => ({id,name:'山田 花子',kind:'student',aliases:[],calendars:[]}));
  let state = {revision:0,categories:['その他'],roles:[],tasks:[],plannerVersion:1};
  await page.route('**/api/todo', async route => {
   if (route.request().method() === 'PUT') state = {...state,...route.request().postDataJSON(),revision:state.revision+1};
   return route.fulfill({json:state});
  });
  await page.route('**/api/lesson-history/owners?*', r => r.fulfill({json:owners}));
  await page.route('**/api/lesson-history/records?*', r => r.fulfill({json:[]}));
  await page.route('**/api/lesson-history/owner-memo?*', r => r.fulfill({json:{memo:'確認用の生徒メモ'}}));
  await page.route('**/api/lesson-plan?*', r => r.fulfill({json:{attribution_status:'confirmed',owner_id:'one'}}));
  await page.goto(fixture.base+'/todo/#works-quick=todo');
  const input=page.locator('#quick-title');
  await input.fill('添削 @山田');
  await expect(page.getByRole('option',{name:/山田 花子/})).toHaveCount(2);
  await input.press('Enter'); await expect(page.locator('#capture-students')).toBeEmpty();
  await page.getByRole('option',{name:/ID two/}).click();
  await expect(page.locator('#capture-students')).toContainText('山田 花子');
  await input.fill('添削 @山田'); await page.getByRole('option',{name:'ラベル　@山田',exact:true}).click();
  await page.locator('#capture-submit').click();
  await expect.poll(()=>state.tasks.length).toBe(1);
  assert.deepEqual(state.tasks[0].plan.students,[{id:'two',name:'山田 花子'}]);
  assert.equal(state.planner.labels.find(l=>l.id===state.tasks[0].plan.labels[0]).name,'山田');
  await page.goto(fixture.base + '/todo/?task=' + state.tasks[0].id);
  const href=await page.locator('#summary-students a').getAttribute('href');
  assert.equal(href,'/tutor/?todo_owner=two');
  await page.goto(fixture.base + href);
  const profile=page.locator('#linked-student-profile');
  await expect(profile).toContainText('確認用の生徒メモ');
  await expect(profile.getByRole('link',{name:'添削'})).toHaveAttribute('href','/todo/?task='+state.tasks[0].id);
  await profile.getByRole('link',{name:'＋ この生徒のToDo'}).click();
  await expect(page.locator('#capture-students')).toContainText('山田 花子');
  await input.fill('返却'); await page.locator('#capture-submit').click();
  await expect.poll(()=>state.tasks.length).toBe(2);
  assert.equal(state.tasks[1].plan.students[0].id,'two');
  await page.goto('about:blank');
  await page.goto(fixture.base + '/todo/#kind=lesson&name=授業&day=2026-11-20&event=e&calendar=c');
  await expect(page.locator('#capture-students')).toContainText('山田 花子');
  await input.fill('授業準備'); await page.locator('#capture-submit').click();
  await expect.poll(()=>state.tasks.length).toBe(3);
  assert.equal(state.tasks[2].plan.source.event,'e');
  assert.equal(state.tasks[2].plan.students[0].id,'one');
  assert.deepEqual(errors,[]);
  await context.close();
 }
 console.log('Student mentions and labels, stable profile, related tasks and lesson origin passed on phone and desktop');
} finally { await browser.close(); await fixture.close(); }
