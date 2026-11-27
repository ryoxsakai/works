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
 await context.route('**/api/**',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.pathname==='/api/terms')return route.fulfill({json:[term]});
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
 console.log('PASS /tutor/ 390px: numbered plan survives a moved/recreated event, follows reordering, has a next slot before Google dates, and is shared with student curriculum.');
} finally{
 await browser?.close();
 await f.close();
}
