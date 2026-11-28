import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createFixture} from './next-lesson-fixture.mjs';
import {handleTermLessonPlans} from '../src/term-lesson-plans.js';

const fixture=await createFixture();
let browser;
try {
  const day=offset=>new Date(Date.parse(fixture.today+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
  const fall={id:3,year_id:1,label:'後期',start_date:day(-10),end_date:day(0)};
  const winter={id:2,year_id:1,label:'冬期',start_date:day(0),end_date:day(20)};
  const terms=[fall,winter];
  const name='合成生徒';
  const make=(id,offset)=>({id,calendar_id:'qa',summary:name,etag:'"'+id+'-1"',start:{dateTime:day(offset)+'T10:00:00+09:00'},end:{dateTime:day(offset)+'T11:00:00+09:00'}});
  const earlier=make('fall-only',-3), overlap=make('overlap-boundary',0), later=make('winter-only',3);
  fixture.events.splice(0,fixture.events.length,earlier,overlap,later);
  const numberedWrites=[];
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const width=Number(process.env.TEST_VIEWPORT_WIDTH||390);
  const context=await browser.newContext({viewport:{width,height:844},isMobile:width<700,hasTouch:width<700,reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.base?route.fallback():route.abort());
  let selected=[fall.id,winter.id], modes={};
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/api/terms')return route.fulfill({json:terms});
    if(url.pathname==='/api/settings'&&req.method()==='GET')return route.fulfill({json:{...await fixture.deps.settings(),selected_term_ids:selected,term_plan_modes:modes}});
    if(url.pathname!=='/api/term-lesson-plans')return route.fallback();
    const body=req.postDataJSON();
    if(req.method()==='PUT')numberedWrites.push(body);
    try {
      const result=await handleTermLessonPlans(new Request(req.url(),{method:req.method(),body:JSON.stringify(body)}),fixture.DB,{calendars:['qa'],terms});
      return route.fulfill({json:result});
    } catch(error) {
      return route.fulfill({status:error.status||500,json:{error:error.message}});
    }
  });
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const open=event=>page.goto(fixture.base+'/tutor/?'+new URLSearchParams({record_date:event.start.dateTime.slice(0,10),student_calendar:'qa',student_event:event.id}));
  const row=event=>page.locator('#curriculum-tbody').locator('tr[data-event-id="'+event.id+'"]');
  const heading=event=>row(event).evaluate(el=>{
    let previous=el.previousElementSibling;
    while(previous&&!previous.classList.contains('curriculum-term-heading'))previous=previous.previousElementSibling;
    return previous?.textContent?.trim()??null;
  });
  const save=async(field,status,value)=>{
    await expect(field).toBeEnabled();
    await field.fill(value);
    await field.press('Tab');
    await expect(status).toHaveText('保存済み');
  };
  const termSlot=(term_id,ordinal)=>({term_id,calendar_id:'qa',title:name,ordinal});
  const numbered=(event,ordinal)=>row(event).getByRole('textbox',{name:'第'+ordinal+'回の授業予定',exact:true});
  const numberedStatus=event=>row(event).locator('[data-term-slot] [role=status]');
  const rowScope=async event=>assert.equal(await heading(event),event===later?'冬期':'後期');

  await open(earlier);
  await expect(row(overlap)).toBeVisible();
  await rowScope(overlap);
  await rowScope(later);
  await expect(row(overlap).locator('[data-term-slot]')).toHaveCount(0);
  await save(row(overlap).locator('.curriculum-plan'),row(overlap).locator('.lesson-plan-status'),'後期の予定だけ更新');
  assert.deepEqual(fixture.control.writes.map(body=>body.target.id),[overlap.id]);
  const stored=await fixture.DB.prepare('SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id=?').bind(overlap.id).first();
  assert.equal(stored?.lesson_plan,'後期の予定だけ更新');
  assert.deepEqual(numberedWrites,[]);
  await save(numbered(later,2),numberedStatus(later),'冬期第2回を更新');
  assert.deepEqual(numberedWrites.map(body=>body.slot),[termSlot(winter.id,2)]);

  // Both terms numbered: the displayed fall row is saved as fall, not winter.
  modes={[fall.id]:true};
  await open(earlier);
  await expect(numbered(overlap,2)).toBeEnabled();
  await rowScope(overlap);
  await save(numbered(overlap,2),numberedStatus(overlap),'後期第2回を更新');
  assert.deepEqual(numberedWrites.map(body=>body.slot),[termSlot(winter.id,2),termSlot(fall.id,2)]);

  // Winter-only keeps the configured start and the occurrence-based numbering.
  selected=[winter.id];
  await open(overlap);
  await expect(row(earlier)).toHaveCount(0);
  await expect(numbered(later,2)).toHaveValue('冬期第2回を更新');
  await expect(numbered(overlap,1)).toHaveValue('');
  await save(numbered(overlap,1),numberedStatus(overlap),'冬期第1回を更新');
  assert.deepEqual(numberedWrites.map(body=>body.slot),[termSlot(winter.id,2),termSlot(fall.id,2),termSlot(winter.id,1)]);
  assert.equal(fixture.control.writes.length,1);
  assert.deepEqual(errors,[]);
  console.log(`PASS /tutor/ ${width}px: curriculum heading, editor and API save agree for overlapping terms.`);
} finally {
  await browser?.close();
  await fixture.close();
}
