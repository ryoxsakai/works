import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {findNextLesson,lessonEventRef,isScheduledLesson} from '../../shared/lesson-plan.js';
import {ensureAttribution} from '../src/lesson-attribution.js';
import {readLessonPlan,readNextLessonPlan,writeLessonPlan} from '../src/lesson-plan.js';

const event=(id,date='2026-10-17',hour=10,calendar='class-a',summary='山田')=>({id,calendar_id:calendar,summary,etag:`"${id}-1"`,start:{dateTime:`${date}T${hour}:00:00+09:00`},end:{dateTime:`${date}T${hour+1}:00:00+09:00`}});
async function setup(t) {
  const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'next-plan-test'}});
  t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB');
  await DB.prepare('CREATE TABLE curriculum_entries (calendar_event_id TEXT PRIMARY KEY, completed INTEGER DEFAULT 0, lesson_plan TEXT, confirmation_test TEXT, homework TEXT, lesson_memo TEXT, updated_at TEXT)').run();
  await DB.prepare("INSERT INTO curriculum_entries VALUES ('b',1,'既存の次回予定','既存テスト','既存宿題','既存授業メモ','old')").run();
  const events=[event('a'),event('b','2026-10-17',11),event('c','2026-10-24'),event('other','2026-10-17',10,'class-b')];
  const settings={selected_calendars:['class-a','class-b'],excluded_titles:['空き']};
  const deps={settings:async()=>settings,token:async()=>({access_token:'synthetic'}),
    event:async(_token,cal,id)=>structuredClone(events.find(e=>e.calendar_id===cal&&e.id===id)||null),
    events:async(_token,cal,min,max)=>structuredClone(events.filter(e=>e.calendar_id===cal&&Date.parse(e.end.dateTime)>Date.parse(min)&&Date.parse(e.start.dateTime)<Date.parse(max)))};
  const env={DB};
  await ensureAttribution(env);
  await DB.prepare("INSERT INTO lesson_record_identity(event_id,calendar_id,title,revision) VALUES ('b','class-a','山田',0)").run();
  return {env,events,settings,deps,DB};
}
test('exact title and calendar, consecutive same-day lessons and excluded slots',()=>{
  const a=event('a'),b=event('b','2026-10-17',11);
  const skips=[{...b,id:'cancel',status:'cancelled'},{...b,id:'all-day',start:{date:'2026-10-17'},end:{date:'2026-10-18'}},
    {...b,id:'declined',attendees:[{self:true,responseStatus:'declined'}]},{...b,id:'free',transparency:'transparent'},
    {...b,id:'absent',summary:'山田（欠席）'},{...b,id:'closed',summary:'山田 休講'},{...b,id:'admin',summary:'会議'},
    {...b,id:'wt',summary:'WT作成'},{...b,id:'circle',summary:'山田○'},event('same-name',undefined,11,'class-b'),event('similar',undefined,11,'class-a','山田太郎')];
  assert.equal(findNextLesson(a,[...skips,b]).target.id,'b');
  for(const e of skips.slice(0,9))assert.equal(isScheduledLesson(e),false,e.id);
  assert.equal(findNextLesson(a,[{...b,summary:'山田（英語）'}]).target,null,'annotations are not stripped into another class');
  assert.equal(findNextLesson(a,[{...b,summary:' 山田  '}]).target.id,'b');
  assert.equal(isScheduledLesson({...b,summary:'山田（辞退）'}),false);
  assert.equal(findNextLesson({...a,summary:'山田（辞退）'},[{...b,summary:'山田（辞退）'}]).reason,'ineligible');
  assert.equal(findNextLesson(a,[{...b,summary:'山田（辞退）'}]).target,null);
});
test('equally early duplicate classes are ambiguous and an empty series stays empty',()=>{
  const a=event('a'),b=event('b','2026-10-17',11);
  assert.equal(findNextLesson(a,[b,{...b,id:'duplicate'}]).reason,'ambiguous');
  assert.equal(findNextLesson(a,[]).reason,'none');
});
test('read preserves the existing next plan and does not create a source record',async t=>{
  const {env,deps,DB}=await setup(t);const next=await readNextLessonPlan(env,'class-a','a',deps);
  assert.equal(next.target.id,'b');assert.equal(next.lesson_plan,'既存の次回予定');
  assert.equal(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='a'").first(),null);
  assert.equal(Date.parse(next.search_end)-Date.parse(next.source.end),366*86400000);
});
test('linked save changes only the next event lesson_plan, retaining every other field',async t=>{
  const {env,deps,DB}=await setup(t);const next=await readNextLessonPlan(env,'class-a','a',deps);
  await writeLessonPlan(env,{source:next.source,target:next.target,record_revision:next.record_revision,expected_lesson_plan:next.lesson_plan,lesson_plan:'連動した予定'},deps);
  const row=await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='b'").first();
  assert.equal(row.lesson_plan,'連動した予定');assert.equal(row.completed,1);assert.equal(row.homework,'既存宿題');
  assert.equal(row.confirmation_test,'既存テスト');assert.equal(row.lesson_memo,'既存授業メモ');
  assert.equal(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='a'").first(),null);
});
test('a direct lesson edit is the same persisted value shown through its previous lesson',async t=>{
  const {env,deps}=await setup(t);const plan=await readLessonPlan(env,'class-a','b',deps);
  await writeLessonPlan(env,{target:plan.target,record_revision:plan.record_revision,expected_lesson_plan:plan.lesson_plan,lesson_plan:'当日の画面から変更'},deps);
  assert.equal((await readNextLessonPlan(env,'class-a','a',deps)).lesson_plan,'当日の画面から変更');
});
for(const change of ['move','cancel','earlier','source'])test(`changed schedule blocks a stale destination: ${change}`,async t=>{
  const {env,deps,events,DB}=await setup(t);const next=await readNextLessonPlan(env,'class-a','a',deps);
  if(change==='move')events[1]={...event('b','2026-10-25'),etag:'"b-2"'};
  if(change==='cancel')events[1].status='cancelled';
  if(change==='earlier')events.push(event('new','2026-10-17',11));
  if(change==='source')events[0].summary='佐藤';
  await assert.rejects(writeLessonPlan(env,{source:next.source,target:next.target,record_revision:next.record_revision,expected_lesson_plan:next.lesson_plan,lesson_plan:'保存してはいけない'},deps),error=>error.status===409);
  assert.equal((await DB.prepare("SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id='b'").first()).lesson_plan,'既存の次回予定');
});
test('no next lesson and cross-calendar ID collisions never create an entry',async t=>{
  const {env,deps,events,DB}=await setup(t);
  assert.equal((await readNextLessonPlan(env,'class-b','other',deps)).target,null);
  events.push(event('b','2026-10-24',11,'class-b'));
  await assert.rejects(readNextLessonPlan(env,'class-a','a',deps),error=>error.code==='LESSON_ID_COLLISION');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM curriculum_entries').first()).n,1);
});
test('source changes during the fresh lookup are caught again before the SQL write',async t=>{
  const {env,deps,events,DB}=await setup(t);const next=await readNextLessonPlan(env,'class-a','a',deps);
  const read=deps.event;
  deps.event=async(token,cal,id)=>{
    if(cal==='class-a'&&id==='b')events[0].etag='"source-changed-after-list"';
    return read(token,cal,id);
  };
  await assert.rejects(writeLessonPlan(env,{source:next.source,target:next.target,record_revision:next.record_revision,expected_lesson_plan:next.lesson_plan,lesson_plan:'x'},deps),e=>e.code==='LESSON_TARGET_CHANGED');
  assert.equal((await DB.prepare("SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id='b'").first()).lesson_plan,'既存の次回予定');
});
test('concurrent writers preserve one winner for a stale baseline',async t=>{
  const {env,deps,DB}=await setup(t);const plan=await readLessonPlan(env,'class-a','b',deps);
  const body={target:plan.target,record_revision:plan.record_revision,expected_lesson_plan:plan.lesson_plan};
  const results=await Promise.allSettled(['一','二'].map(lesson_plan=>writeLessonPlan(env,{...body,lesson_plan},deps)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'LESSON_PLAN_CONFLICT');
  assert.ok(['一','二'].includes((await DB.prepare("SELECT lesson_plan FROM curriculum_entries WHERE calendar_event_id='b'").first()).lesson_plan));
});
test('only an empty expected baseline can create a new target record',async t=>{
  const {env,deps,DB}=await setup(t);const plan=await readLessonPlan(env,'class-a','c',deps);
  await assert.rejects(writeLessonPlan(env,{target:plan.target,record_revision:plan.record_revision,expected_lesson_plan:'stale',lesson_plan:'x'},deps),e=>e.status===409);
  assert.equal(await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='c'").first(),null);
  await writeLessonPlan(env,{target:plan.target,record_revision:plan.record_revision,expected_lesson_plan:'',lesson_plan:'新しい予定'},deps);
  assert.equal((await DB.prepare("SELECT * FROM curriculum_entries WHERE calendar_event_id='c'").first()).lesson_plan,'新しい予定');
});
test('a partial update cannot restore a stale plan or overwrite a racing writer',async t=>{
  const {env,DB}=await setup(t);
  const {rawRecord,recordWriteStatements,commitRecords}=await import('../src/lesson-attribution.js');
  const row=await rawRecord(env,'b');
  const statements=await recordWriteStatements(env,{id:'b',calendar_id:'class-a',title:'山田'},{homework:'新しい宿題'},row.record_revision);
  await DB.prepare("UPDATE curriculum_entries SET lesson_plan='新しい別画面の予定' WHERE calendar_event_id='b'").run();
  await assert.rejects(commitRecords(env,statements),e=>e.code==='LESSON_RECORD_CONFLICT');
  const latest=await rawRecord(env,'b');
  await commitRecords(env,await recordWriteStatements(env,{id:'b',calendar_id:'class-a',title:'山田'},{homework:'新しい宿題'},latest.record_revision));
  const saved=await rawRecord(env,'b');assert.equal(saved.lesson_plan,'新しい別画面の予定');assert.equal(saved.homework,'新しい宿題');
});

test('a same-title replacement after commit cannot be returned as the original save response',async t=>{
  const {env,deps,DB}=await setup(t);
  const {ensureAttribution,rawRecord,resolveAttribution,recordWriteStatements,commitRecords}=await import('../src/lesson-attribution.js');
  const plan=await readLessonPlan(env,'class-a','b',deps);
  let armed=false;
  const proxy={prepare:DB.prepare.bind(DB),async batch(statements){
    const result=await DB.batch(statements);
    if(armed){
      armed=false;
      const row=await rawRecord(env,'b');
      await resolveAttribution(env,plan.target,row.record_revision,'separate');
      const next=await rawRecord(env,'b');
      await commitRecords(env,await recordWriteStatements(env,plan.target,{lesson_plan:'other student private content'},next.record_revision));
    }
    return result;
  }};
  const proxyEnv={DB:proxy};await ensureAttribution(proxyEnv);armed=true;
  await assert.rejects(writeLessonPlan(proxyEnv,{target:plan.target,record_revision:plan.record_revision,expected_lesson_plan:plan.lesson_plan,lesson_plan:'my committed plan'},deps),error=>{
    assert.equal(error.code,'LESSON_RECORD_CHANGED_AFTER_SAVE');assert.equal(error.committed,true);
    assert.equal(JSON.stringify(error).includes('other student private content'),false);return true;
  });
  const archive=await DB.prepare('SELECT * FROM lesson_record_archive').first();
  assert.equal(JSON.parse(archive.snapshot_json).lesson_plan,'my committed plan');
  assert.equal((await rawRecord(env,'b')).lesson_plan,'other student private content');
});

test('a stale same-title save conflict withholds the new ownership generation plan',async t=>{
  const {env,deps}=await setup(t);const plan=await readLessonPlan(env,'class-a','b',deps);
  const {rawRecord,resolveAttribution,recordWriteStatements,commitRecords}=await import('../src/lesson-attribution.js');
  await resolveAttribution(env,plan.target,plan.record_revision,'separate');
  const next=await rawRecord(env,'b');
  await commitRecords(env,await recordWriteStatements(env,plan.target,{lesson_plan:'private replacement plan'},next.record_revision));
  await assert.rejects(writeLessonPlan(env,{target:plan.target,record_revision:plan.record_revision,expected_lesson_plan:plan.lesson_plan,lesson_plan:'old draft'},deps),error=>{
    assert.equal(error.code,'LESSON_PLAN_CONFLICT');assert.equal(error.current.lesson_plan,'');
    assert.equal(JSON.stringify(error).includes('private replacement plan'),false);return true;
  });
});
