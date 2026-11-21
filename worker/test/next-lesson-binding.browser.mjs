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
 await f.DB.prepare("INSERT INTO terms VALUES(2,'後期','2026-09-03','2026-12-05')").run();
 const id=()=>crypto.randomUUID(),name='合成生徒',plan='次回予定の合成テスト\n2行目';
 const make=(id,date,summary)=>({id,calendar_id:'qa',summary,etag:'"v1"',created:'2026-01-01T00:00:00Z',iCalUID:id+'-uid',start:{dateTime:date+'T10:20:00+09:00'},end:{dateTime:date+'T11:40:00+09:00'}});
 const previous=make('confirmed-source','2026-11-21',name),next=make('changed-vacancy','2026-11-23','○');
 f.events.splice(0,f.events.length,previous,next);
 const person=(await createLessonOwner(f.env,{request_id:id(),name,kind:'student'})).owner;
 const source=lessonEventRef(previous);
 await changeLessonBinding(f.env,{target:source,link_revision:0,decision:'new',owner_id:person.id,owner_revision:person.revision,request_id:id()},f.deps);
 Object.assign(next,{summary:name,etag:'"renamed"'});
 const target=lessonEventRef(next),shown=await readEventOwnerRecord(f.env,target,next,f.deps);
 await writePendingLessonPlan(f.env,{target,pending_context:shown.pending_context,record_revision:0,expected_lesson_plan:'',lesson_plan:plan,request_id:id()},f.deps);
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 let writes=0;
 await context.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.method()==='GET'?null:req.postDataJSON();
  try{
   let value;
   if(url.pathname.startsWith('/api/lesson-history/')){
    if(url.pathname.endsWith('/next-binding'))writes++;
    value=await handleOwnerHistory(f.env,new Request(req.url(),{method:req.method(),headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),url,f.deps);
   }else if(url.pathname==='/api/terms') value=(await f.DB.prepare('SELECT *,1 AS year_id FROM terms').all()).results;
   else if(url.pathname==='/api/lesson-records') value=await Promise.all(body.targets.map(target=>readEventOwnerRecord(f.env,target,f.events.find(e=>e.id===target.id),f.deps)));
   else return route.continue();
   return route.fulfill({json:value});
  }catch(error){return route.fulfill({status:error.status||500,json:{error:error.message,code:error.code}});}
 });
 const page=await context.newPage(),errors=[];
 await page.clock.install({time:new Date('2026-11-21T00:00:00+09:00')});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(f.base+'/tutor/?record_date=2026-11-21');
 const editor=page.locator('.record-next-plan'),link=editor.locator('.next-owner-review');
 await expect(editor.locator('textarea')).toHaveValue(plan);
 await expect(link).toHaveText('次回の紐づけと下書きを確認');
 await expect(link).toHaveAttribute('href',/next_source_id=confirmed-source/);
 assert.equal(writes,0);
 await link.click();
 const panel=page.locator('#next-binding-review');
 await expect(panel).toContainText('生徒「合成生徒」');
 await expect(panel.locator('pre')).toHaveText(plan);
 assert.equal(writes,0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await panel.getByRole('button',{name:'同じ生徒「合成生徒」に紐づけて下書きを引き継ぐ',exact:true}).click();
 await expect(panel).toContainText('次回の紐づけと授業予定を保存しました。');
 assert.equal(writes,1);
 await panel.getByRole('link',{name:'元の授業記録へ戻る'}).click();
 await expect(editor.locator('textarea')).toHaveValue(plan);
 await expect(editor.locator('.lesson-plan-target')).toContainText('連動先');
 assert.equal(writes,1);
 assert.equal((await f.DB.prepare('SELECT count(*) n FROM lesson_pending_plans').first()).n,1);
 assert.deepEqual(errors,[]);
 console.log('PASS mobile Tutor confirmation link, read-only preview, atomic bind and draft restoration');
}finally{
 await browser?.close();
 await f.close();
}
