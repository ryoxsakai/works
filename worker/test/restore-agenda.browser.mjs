import {chromium, expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {createFixture} from './next-lesson-fixture.mjs';

const fixture = await createFixture();
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? {executablePath:process.env.BROWSER_EXECUTABLE} : {});
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*', route => new URL(route.request().url()).origin === fixture.base ? route.continue() : route.abort());
  let state = {revision:1, plannerVersion:1, roles:[], categories:[], tasks:[
    {id:'past',name:'遅延タスク',plannedDay:'2020-01-01',deadline:'2099-12-01'},
    {id:'due',name:'締切のみ',deadline:'2020-01-02'},
    {id:'done',name:'完了分',status:'done',deadline:'2020-01-01'}
  ]};
  await page.route('**/api/todo', route => {
    if (route.request().method() === 'PUT') state = {...route.request().postDataJSON(), revision:state.revision+1};
    return route.fulfill({json:state});
  });
  await page.goto(fixture.base);
  await page.evaluate(()=>{localStorage.setItem('works_session_token','qa');localStorage.setItem('works_last_service','/todo/');});
  await page.reload();
  await page.waitForURL(fixture.base+'/todo/');
  const view=page.frameLocator('iframe:not([inert])');
  await expect(view.locator('.bottom-tabs [data-view]').first()).toHaveAttribute('data-view','upcoming');
  await view.locator('#reschedule-open').click();
  await expect(view.locator('#reschedule-items input')).toHaveCount(2);
  await view.locator('#reschedule-items input[value="due"]').uncheck();
  await view.locator('#reschedule-date').fill('2099-01-01');
  await view.getByRole('button',{name:'日付を変更',exact:true}).click();
  await expect.poll(()=>state.tasks[0].plannedDay).toBe('2099-01-01');
  assert.equal(state.tasks[0].deadline,'2099-12-01');
  assert.equal(state.tasks[1].deadline,'2020-01-02');
  await view.locator('.bottom-tabs [data-view="inbox"]').click();
  await page.goto(fixture.base);
  await page.waitForURL(fixture.base+'/todo/');
  await expect(view.locator('.bottom-tabs [aria-current]')).toHaveAttribute('data-view','inbox');
  console.log('Passed root restore, ToDo tab persistence and selective overdue rescheduling.');
} finally {await browser.close();await fixture.close();}
