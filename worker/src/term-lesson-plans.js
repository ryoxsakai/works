import {lessonTitleKey} from '../../shared/lesson-attribution.js';
import {termPlanKey} from '../../shared/term-lesson-plan.mjs';

const fail = (status,message) => Object.assign(new Error(message), {status});
const schema = `CREATE TABLE IF NOT EXISTS term_lesson_plans (
  term_id INTEGER NOT NULL, calendar_id TEXT NOT NULL, title TEXT NOT NULL,
  ordinal INTEGER NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL,
  PRIMARY KEY (term_id, calendar_id, title, ordinal)
)`;
const ready = new WeakMap();
async function ensure(db) {
  if (!ready.has(db)) ready.set(db, db.prepare(schema).run().catch(err=>{ready.delete(db);throw err;}));
  await ready.get(db);
}

function validSlot(value, calendars, terms) {
  if (!value || !Number.isSafeInteger(value.term_id) || !terms.has(value.term_id)
    || typeof value.calendar_id!=='string' || !calendars.has(value.calendar_id)
    || typeof value.title!=='string' || value.title.length>300 || !value.title || lessonTitleKey(value.title)!==value.title
    || !Number.isSafeInteger(value.ordinal) || value.ordinal<1 || value.ordinal>10000) throw fail(400,'学期・カレンダー・授業名・回数を確認してください');
  const {term_id,calendar_id,title,ordinal}=value;
  return {term_id,calendar_id,title,ordinal};
}
const args = ({term_id,calendar_id,title,ordinal})=>[term_id,calendar_id,title,ordinal];
const select = 'SELECT term_id,calendar_id,title,ordinal,value,revision FROM term_lesson_plans WHERE (term_id,calendar_id,title,ordinal) IN';

export async function handleTermLessonPlans(request, db, {calendars,terms}) {
  if (!['POST','PUT'].includes(request.method)) throw fail(405,'method not allowed');
  let body;try{body=await request.json();}catch{throw fail(400,'入力を確認してください');}
  const calendarSet=new Set(calendars), termSet=new Set(terms.map(t=>t.id));
  if (request.method==='POST') {
    if (!Array.isArray(body?.slots) || body.slots.length>200) throw fail(400,'対象回を確認してください');
    const slots=[...new Map(body.slots.map(item=>{const slot=validSlot(item,calendarSet,termSet);return [termPlanKey(slot),slot];})).values()];
    if (!slots.length) return {plans:[]};
    await ensure(db);
    const queries=[];
    // D1 caps a statement at 100 bound parameters.
    for(let i=0;i<slots.length;i+=20){
      const chunk=slots.slice(i,i+20);
      // UNION-free, SQLite-compatible row membership via VALUES.
      queries.push(db.prepare(select + ' (VALUES '+chunk.map(()=>'(?,?,?,?)').join(',')+')').bind(...chunk.flatMap(args)));
    }
    return {plans:(await db.batch(queries)).flatMap(r=>r.results)};
  }
  const slot=validSlot(body?.slot,calendarSet,termSet);
  const {value,revision}=body;
  if(typeof value!=='string'||value.length>5000||!Number.isSafeInteger(revision)||revision<0||revision>=Number.MAX_SAFE_INTEGER)
    throw fail(400,'授業予定または保存版を確認してください');
  await ensure(db);
  const query=revision===0
    ? 'INSERT INTO term_lesson_plans(term_id,calendar_id,title,ordinal,value,revision) VALUES(?,?,?,?,?,1) ON CONFLICT DO NOTHING RETURNING value,revision'
    : 'UPDATE term_lesson_plans SET value=?,revision=revision+1 WHERE term_id=? AND calendar_id=? AND title=? AND ordinal=? AND revision=? RETURNING value,revision';
  const saved=await db.prepare(query).bind(...(revision===0?[...args(slot),value]:[value,...args(slot),revision])).first();
  if(!saved)throw fail(409,'別の画面で更新されています。現在の保存内容を再確認してください');
  return {...slot,...saved};
}
