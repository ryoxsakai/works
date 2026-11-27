import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {createFixture} from './next-lesson-fixture.mjs';
import {handleTermLessonPlans} from '../src/term-lesson-plans.js';
const f=await createFixture();
let browser;
try{
 const day=days=>new Date(Date.parse(f.today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 const term={id:2,year_id:1,label:'冬期',start_date:day(-2),end_date:day(20)};
 const name='合成生徒';
 const make=(id,offset,summary=name,calendar_id='qa')=>({id,calendar_id,summary,etag:'"'+id+'-1"',start:{dateTime:day(offset)+'T10:00:00+09:00'},end:{dateTime:day(offset)+'T11:00:00+09:00'}});
 const a=make('ordinal-first',0), b=make('ordinal-second',3), other=make('other-calendar',1,name,'qa-tomas'), x=make('ordinal-inserted',1);
 f.events.splice(0,f.events.length,a,b,other);
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const writes=[], legacyPlanRequests=[];
 const previousEventDraft='以前の予定別に保存していた下書き';
 let unassignedEventId;
 await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/terms')return route.fulfill({json:[term]});
   if(url.pathname==='/api/lesson-records'&&unassignedEventId){
     const target=req.postDataJSON().targets[0];
     if(target.id===unassignedEventId)return route.fulfill({json:[{
       calendar_event_id:target.id,record_storage:'d1_owner',attribution_status:'owner_unassigned',
       record_exists:false,record_read_target:target,record_revision:4,completed:0,
       pending_allowed:true,pending_storage_available:true,pending_exists:true,pending_context:'qa-old-draft',
       lesson_plan:previousEventDraft,
     }]});
   }
   if(url.pathname==='/api/lesson-plan'||url.pathname==='/api/next-lesson-plan')legacyPlanRequests.push(url.pathname);
   if(url.pathname!=='/api/term-lesson-plans')return route.continue();
   const body=req.postDataJSON();
   if(req.method()==='PUT')writes.push(body);
   try{
     const result=await handleTermLessonPlans(new Request(req.url(),{method:req.method(),body:JSON.stringify(body)}),f.DB,{calendars:['qa','qa-tomas'],terms:[term]});
     return route.fulfill({json:result});
   } catch(error) {
     return route.fulfill({status:error.status||500,json:{error:error.message}});
   }
 });
 const page=await context.newPage(),errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 const open=offset=>page.goto(f.base+'/tutor/?record_date='+day(offset));
 await open(0);
 const card=page.locator('tr[data-term-record]');
 await expect(card).toContainText('1/2回');
 const next=card.getByRole('textbox',{name:/次回授業予定（第2回/});
 await expect(next).toBeEnabled();
 await next.fill('回数と一緒に残る次回計画');
 await next.press('Tab');
 await expect(card.locator('.record-next-plan [role=status]')).toHaveText('保存済み');
 assert.equal(writes.length,1);
 assert.deepEqual(writes[0].slot,{term_id:2,calendar_id:'qa',title:name,ordinal:2});
 assert.doesNotMatch(JSON.stringify(writes[0]),/ordinal-first|ordinal-second/);
 const moved=make('replacement-id',5);
 f.events.splice(1,1,moved);
 await open(5);
 const current=card.getByRole('textbox',{name:'第2回の授業予定'});
 await expect(current).toHaveValue('回数と一緒に残る次回計画');
 await expect(card).toContainText('2/2回');
 await expect(card.getByRole('textbox',{name:'次回授業予定（第3回・日程未定）'})).toBeEnabled();
 f.events.push(x);
 await open(5);
 await expect(card).toContainText('3/3回');
 await expect(card.getByRole('textbox',{name:'第3回の授業予定'})).toHaveValue('');
 await open(1);
 const qa=page.locator('tr[data-term-record]').filter({has:page.locator('[data-calendar-id="qa"]')});
 await expect(qa.getByRole('textbox',{name:'第2回の授業予定'})).toHaveValue('回数と一緒に残る次回計画');
 const tomas=page.locator('tr[data-term-record]').filter({has:page.locator('[data-calendar-id="qa-tomas"]')});
 await expect(tomas.getByRole('textbox',{name:'第1回の授業予定'})).toHaveValue('');
 await qa.getByRole('button',{name:name+'の生徒情報を開く'}).click();
 await expect(page.locator('#curriculum-tbody').getByRole('textbox',{name:'第2回の授業予定'})).toHaveValue('回数と一緒に残る次回計画');
 assert.deepEqual(errors,[]);
 assert.deepEqual(legacyPlanRequests,[]);
 assert.equal(writes.length,1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 // Make the next occurrence a distinct, pending-eligible, unassigned lesson
 // with an old draft unrelated to the currently saved numbered plan.
 const pending=make('pending-lesson',1);
 unassignedEventId=pending.id;
 f.events.splice(0,f.events.length,a,pending);
 await open(1);
 await page.locator('[data-page-tab="record"]').click();
 const pendingCard=page.locator('tr[data-record-card]').filter({hasText:name});
 const pendingNumber=pendingCard.getByRole('textbox',{name:'第2回の授業予定'});
 await expect(pendingNumber).toHaveValue('回数と一緒に残る次回計画');
 await expect(pendingCard.locator('.linked-lesson-plan')).toHaveCount(0);
 await expect(pendingCard.locator('[data-term-slot]')).toHaveCount(2);
 await expect(pendingCard.locator('.pending-bind-link')).toHaveCount(1);
 await pendingCard.locator('[data-term-previous] summary').click();
 await expect(pendingCard.getByText(previousEventDraft,{exact:true})).toBeVisible();
 // Keep the same app instance when moving to the student's curriculum.
 await page.locator('.record-day-btn[data-day="prev"]').click();
 await page.getByRole('button',{name:name+'の生徒情報を開く'}).click();
 const curriculum=page.locator('#curriculum-tbody tr[data-unassigned-progress]');
 const numbered=curriculum.getByRole('textbox',{name:'第2回の授業予定'});
 await expect(numbered).toHaveValue('回数と一緒に残る次回計画');
 await expect(curriculum.locator('[data-term-previous] summary')).toHaveText('以前の予定別の記録');
 await curriculum.locator('[data-term-previous] summary').click();
 await expect(curriculum.getByText(previousEventDraft,{exact:true})).toBeVisible();
 assert.equal(await curriculum.getAttribute('data-pending-key'),null,'numbered curriculum must not be routed to the legacy repaint');
 await page.locator('[data-page-tab="curriculum"]').click();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(numbered).toHaveValue('回数と一緒に残る次回計画');
 await numbered.fill('未紐づけでも回数に保存');
 await numbered.press('Tab');
 await expect(curriculum.locator('[data-term-slot] [role=status]')).toHaveText('保存済み');
 assert.equal(writes.length,2);
 assert.deepEqual(writes[1].slot,{term_id:2,calendar_id:'qa',title:name,ordinal:2});
 f.events.push({...make('pending-inserted',0),start:{dateTime:day(0)+'T12:00:00+09:00'},end:{dateTime:day(0)+'T13:00:00+09:00'}});
 await open(1);
 await page.locator('[data-page-tab="record"]').click();
 await expect(pendingCard.getByRole('textbox',{name:'第3回の授業予定'})).toHaveValue('');
 await expect(pendingCard.getByText(previousEventDraft,{exact:true})).toBeVisible();
 await open(0);
 await page.locator('[data-page-tab="record"]').click();
 await expect(page.locator('#record-tbody').getByRole('textbox',{name:'第2回の授業予定',exact:true})).toHaveValue('未紐づけでも回数に保存');
 assert.deepEqual(legacyPlanRequests,[]);
 assert.deepEqual(errors,[]);
 console.log('PASS /tutor/ 390px: numbered plans survive reordered dates and IDs, including unassigned lessons with independent legacy drafts.');
} finally{
 await browser?.close();
 await f.close();
}
