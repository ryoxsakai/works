import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import {createFixture} from './next-lesson-fixture.mjs';
import {changeLessonBinding,createLessonOwner,handleOwnerHistory,readEventOwnerRecord,writePendingLessonPlan} from '../src/lesson-owner-history.js';
import {lessonEventRef} from '../../shared/lesson-plan.js';

const f=await createFixture();
let browser;
try{
 f.env.LESSON_HISTORY_MODE='active';
 for(const file of ['../calendar-lesson-migration.sql','../migrations/lesson-owner-history.sql']){
  const migration=(await readFile(new URL(file,import.meta.url),'utf8')).replace(/^--.*$/gm,'').split(';').filter(sql=>sql.trim());
  await f.DB.batch(migration.map(sql=>f.DB.prepare(sql)));
 }
 await f.DB.prepare("INSERT INTO lesson_history_policy VALUES(1,1,1,'{}')").run();
 await f.DB.prepare("CREATE TABLE terms(id INTEGER PRIMARY KEY,label TEXT,start_date TEXT,end_date TEXT)").run();
 const day=offset=>new Date(Date.now()+(9+24*offset)*3600000).toISOString().slice(0,10);
 await f.DB.prepare("INSERT INTO terms VALUES(2,'後期',?,?)").bind(day(-2),day(15)).run();
 const id=()=>crypto.randomUUID(),name='合成生徒',plan='次回予定の合成テスト\n2行目';
 const make=(id,date,summary)=>({id,calendar_id:'qa',summary,etag:'"v1"',created:'2026-01-01T00:00:00Z',iCalUID:id+'-uid',start:{dateTime:date+'T10:20:00+09:00'},end:{dateTime:date+'T11:40:00+09:00'}});
 const previous=make('confirmed-source',day(0),name),next=make('changed-vacancy',day(2),'○');
 const later=make('old-next',day(4),name), ambiguousSource=make('ambiguous-source',day(6),'合成同姓'),ambiguousTarget=make('ambiguous-next',day(8),'合成同姓');
 f.events.splice(0,f.events.length,previous,next,later,ambiguousSource,ambiguousTarget);
 const addOwner=async(name,kind='student')=>(await createLessonOwner(f.env,{request_id:id(),name,kind})).owner;
 const person=await addOwner(name),duplicate=await addOwner('合成同姓');await addOwner('合成同姓','class');
 const bind=(event,owner)=>changeLessonBinding(f.env,{target:lessonEventRef(event),link_revision:0,decision:'new',owner_id:owner.id,owner_revision:owner.revision,request_id:id()},f.deps);
 const draft=async(event,lesson_plan)=>{
  const target=lessonEventRef(event),shown=await readEventOwnerRecord(f.env,target,event,f.deps);
  return writePendingLessonPlan(f.env,{target,pending_context:shown.pending_context,record_revision:0,expected_lesson_plan:'',lesson_plan,request_id:id()},f.deps);
 };
 await bind(previous,person);await bind(later,person);await bind(ambiguousSource,duplicate);await draft(ambiguousTarget,'紐づけを要確認');
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const writes=[];
 let releaseBinding;const holdBinding=new Promise(resolve=>{releaseBinding=resolve;});
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.method()==='GET'?null:req.postDataJSON();
  try{
   let value;
   if(url.pathname.startsWith('/api/lesson-history/')){
    if(url.pathname.endsWith('/next-binding')){writes.push('bind');await holdBinding;}
    if(url.pathname.endsWith('/next-plan-carry'))writes.push('carry');
    value=await handleOwnerHistory(f.env,new Request(req.url(),{method:req.method(),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),url,f.deps);
   }else if(url.pathname==='/api/terms') value=(await f.DB.prepare('SELECT *,1 AS year_id FROM terms').all()).results;
   else if(url.pathname==='/api/lesson-records') value=await Promise.all(body.targets.map(target=>readEventOwnerRecord(f.env,target,f.events.find(e=>e.id===target.id),f.deps)));
   else return route.continue();
   return route.fulfill({json:value});
  }catch(error){return route.fulfill({status:error.status||500,json:{error:error.message,code:error.code}});}
 });
 const page=await context.newPage(),errors=[];
 await page.clock.install({time:new Date(day(0)+'T00:00:00+09:00')});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(f.base+'/tutor/?record_date='+day(0));
 const editor=page.locator('.record-next-plan'),link=editor.locator('.next-owner-review');
 await expect(editor.locator('.lesson-plan-target')).toContainText(day(4).replaceAll('-','/'));
 await expect(editor.locator('textarea')).toHaveValue('');
 await editor.locator('textarea').fill(plan);
 await editor.locator('textarea').press('Tab');
 await expect(editor.locator('.lesson-plan-status')).toContainText('保存済み');
 assert.deepEqual(writes,[]);
 Object.assign(next,{summary:name,etag:'"renamed"'});
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(editor.locator('.lesson-plan-status')).toHaveText('次回の授業と紐づけています…');
 await expect(link).toHaveCount(0);
 await expect(editor.locator('.lesson-plan-action')).toBeHidden();
 assert.deepEqual(writes,['bind']);
 releaseBinding();
 await expect(editor.locator('textarea')).toHaveValue(plan);
 await expect(editor.locator('.lesson-plan-target')).toContainText('連動先');
 await expect(editor.locator('.lesson-plan-target')).toContainText(day(2).replaceAll('-','/'));
 await expect(link).toHaveCount(0);
 assert.deepEqual(writes,['bind','carry']);
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(editor.locator('textarea')).toHaveValue(plan);
 assert.deepEqual(writes,['bind','carry']);
 assert.equal((await f.DB.prepare("SELECT r.lesson_plan FROM lesson_event_links l JOIN lesson_history_records r ON r.id=l.record_id WHERE l.event_id='old-next'").first()).lesson_plan,'');
 assert.equal((await f.DB.prepare("SELECT r.lesson_plan FROM lesson_event_links l JOIN lesson_history_records r ON r.id=l.record_id WHERE l.event_id='changed-vacancy'").first()).lesson_plan,plan);
 assert.equal((await f.DB.prepare('SELECT count(*) n FROM lesson_pending_plans').first()).n,1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.goto(f.base+'/tutor/?record_date='+day(6));
 await expect(editor.locator('textarea')).toHaveValue('紐づけを要確認');
 await expect(link).toHaveText('次回候補の紐づけを確認');
 assert.doesNotMatch(await link.getAttribute('href'),/next_source_id/);
 await link.click();
 await expect(page.locator('#next-binding-review')).toBeHidden();
 await expect(page.locator('#pending-plan-list')).toContainText('紐づけを要確認');
 assert.deepEqual(writes,['bind','carry']);
 assert.deepEqual(errors,[]);
 console.log('PASS mobile Tutor quietly binds a blank future occurrence and moves only the previous source-authored plan; ambiguous owners stay manual');
}finally{
 await browser?.close();
 await f.close();
}
