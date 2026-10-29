import {curriculumSelectionName} from '../../shared/student-profile-key.js';
import {rawRecord,requireCurrent,guardStatements,commitRecords} from './lesson-attribution.js';
import {sameLessonEvent,isScheduledLesson} from '../../shared/lesson-plan.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object||{},key);
const fields=['print_name','memo'];
export function profileSnapshot(row){return {exists:!!row,print_name:row?.print_name??null,memo:row?.memo??null,updated_at:row?.updated_at??null};}
function snapshotGuard(env,predicate,values){const id=crypto.randomUUID();return [env.DB.prepare(`INSERT INTO lesson_record_guard(id,ok) VALUES (?,CASE WHEN ${predicate} THEN 1 ELSE 0 END)`).bind(id,...values),env.DB.prepare('DELETE FROM lesson_record_guard WHERE id=?').bind(id)];}
async function sourceContext(env,ref,deps,writing=false,selection=ref){
 if(!ref||typeof ref.calendar_id!=='string'||!ref.calendar_id||typeof ref.id!=='string'||!ref.id)throw fail(400,'授業の参照が必要です。');
 if(selection?.profile_context==='alias')await(await import('./lesson-profile-mapping.js')).preflightProfileMapping(env,ref,selection);
 const target=await deps.target(ref);
 if(writing&&!sameLessonEvent(ref,target))throw fail(409,'授業予定が変更されています。入力を残して確認してください。');
 const excluded=await deps.excluded();if(!isScheduledLesson(target,excluded))throw fail(409,'授業対象を確認してください。');
 const row=await rawRecord(env,target.id);requireCurrent(row,target);
 let name=target.title.trim(),profile_context;
 let mapping;
 if(selection?.profile_context==='alias'){const api=await import('./lesson-profile-mapping.js');mapping=await api.resolveProfileMapping(env,target,row,selection);name=mapping.target_name;profile_context='alias';}
 else if(own(selection,'profile_context')){if(selection.profile_context!=='curriculum')throw fail(400,'プロフィールの名前キー種別を確認してください。');name=curriculumSelectionName(target.title);if(!name||selection.name!==name)throw fail(400,'元の予定から決まる名前キーと一致しません。');profile_context='curriculum';}
 return {target,row,name,profile_context,mapping,record_revision:row.record_revision,mapping_guards:mapping?(await import('./lesson-profile-mapping.js')).mappingGuardStatements(env,mapping):[]};
}
function writeContext(context,body){
 if(body.name!==context.name||body.shared_name_acknowledged!==true)throw fail(400,'固定された名前キーと共有情報の確認が必要です。');
 if(!Number.isSafeInteger(body.record_revision)||body.record_revision!==context.record_revision)throw fail(409,'授業記録または対応状態が変更されています。');
}
async function confirmSource(env,context){const row=await rawRecord(env,context.target.id);if(row.record_revision!==context.row.record_revision||row.record_generation!==context.row.record_generation)throw fail(409,'保存後に授業の対応状態が変更されています。再送せず現在の状態を確認してください。');requireCurrent(row,context.target);if(context.mapping)await (await import('./lesson-profile-mapping.js')).confirmProfileMapping(env,context);}
async function profileRow(env,name){return env.DB.prepare('SELECT * FROM student_prefs WHERE name=?').bind(name).first();}
export async function readLinkedProfile(env,ref,deps){const context=await sourceContext(env,ref,deps),profile=profileSnapshot(await profileRow(env,context.name));await confirmSource(env,context);return {target:context.target,name:context.name,...profileContextFields(context),record_revision:context.record_revision,profile};}
export async function writeLinkedProfile(env,body,deps){
 const context=await sourceContext(env,body?.target,deps,true,body);writeContext(context,body);
 const expected=body.expected;if(!expected||typeof expected.exists!=='boolean'||fields.concat('updated_at').some(key=>!own(expected,key)||!(expected[key]===null||typeof expected[key]==='string')))throw fail(400,'取得時の生徒情報が必要です。');
 if(!fields.some(key=>own(body,key)))throw fail(400,'変更する項目が必要です。');
 const current=await profileRow(env,context.name),next={...profileSnapshot(current)};
 for(const [key,max]of [['print_name',200],['memo',20000]])if(own(body,key)){const value=body[key];if(!(value===null||typeof value==='string')||(typeof value==='string'&&value.length>max))throw fail(400,'生徒情報の入力を確認してください。');next[key]=value===null||!value.trim()?null:key==='print_name'?value.trim():value;}
 const predicate=expected.exists?'EXISTS(SELECT 1 FROM student_prefs WHERE name=? AND print_name IS ? AND memo IS ? AND updated_at IS ?)':'NOT EXISTS(SELECT 1 FROM student_prefs WHERE name=?)';
 const matchValues=expected.exists?[context.name,expected.print_name,expected.memo,expected.updated_at]:[context.name];
 // All checks and the write are in one D1 transaction; CHECK failures roll back everything.
 const statements=[...guardStatements(env,context.target.id,body.record_revision),...context.mapping_guards,...snapshotGuard(env,predicate,matchValues),env.DB.prepare(`INSERT INTO student_prefs(name,print_name,memo,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET print_name=excluded.print_name,memo=excluded.memo,updated_at=excluded.updated_at`).bind(context.name,next.print_name,next.memo,new Date().toISOString())];
 await commitRecords(env,statements);await confirmSource(env,context);
 const saved=profileSnapshot(await profileRow(env,context.name));
 if(saved.print_name!==next.print_name||saved.memo!==next.memo)throw fail(409,'保存後に生徒情報が変更されています。再送せず確認してください。');
 return {target:context.target,name:context.name,...profileContextFields(context),record_revision:context.record_revision,profile:saved};
}
async function materials(env,name){
 const {results}=await env.DB.prepare(`SELECT sm.id AS link_id,sm.material_id,m.name AS material_name,c.id AS chapter_id,c.name AS chapter_name,c.sort_order,p.completed,p.updated_at,CASE WHEN p.name IS NULL THEN 0 ELSE 1 END AS progress_exists FROM student_materials sm JOIN materials m ON m.id=sm.material_id LEFT JOIN material_chapters c ON c.material_id=sm.material_id LEFT JOIN chapter_progress p ON p.chapter_id=c.id AND p.name=sm.name WHERE sm.name=? ORDER BY sm.sort_order,sm.id,c.sort_order,c.id`).bind(name).all();
 const grouped=new Map(),seen=new Set();let ambiguous=false;
 for(const row of results){if(!grouped.has(row.link_id))grouped.set(row.link_id,{link_id:row.link_id,material_id:row.material_id,material_name:row.material_name,chapters:[]});if(row.chapter_id!=null){if(seen.has(row.chapter_id))ambiguous=true;seen.add(row.chapter_id);grouped.get(row.link_id).chapters.push({chapter_id:row.chapter_id,chapter_name:row.chapter_name,completed:!!row.completed,exists:!!row.progress_exists,updated_at:row.updated_at??null});}}
 return {materials:[...grouped.values()],ambiguous_assignment:ambiguous};
}
export async function readLinkedProgress(env,ref,deps){const context=await sourceContext(env,ref,deps),value=await materials(env,context.name);await confirmSource(env,context);return {target:context.target,name:context.name,...profileContextFields(context),record_revision:context.record_revision,...value};}
export async function writeLinkedProgress(env,body,deps){
 const context=await sourceContext(env,body?.target,deps,true,body);writeContext(context,body);
 const changeLimit=context.mapping?4:8;
 if(!Array.isArray(body.changes)||!body.changes.length||body.changes.length>changeLimit||new Set(body.changes.map(row=>row?.chapter_id)).size!==body.changes.length)throw fail(400,`進捗は重複なく1〜${changeLimit}項目を保存してください。`);
 const before=await materials(env,context.name);if(before.ambiguous_assignment)throw fail(409,'教材の割当が重複しています。従来画面で確認してください。');
 const statements=[...guardStatements(env,context.target.id,body.record_revision),...context.mapping_guards];
 for(const change of body.changes){if(!change||typeof change!=='object')throw fail(400,'進捗の形式を確認してください。');const expected=change.expected;
  if(!Number.isSafeInteger(change.link_id)||!Number.isSafeInteger(change.material_id)||!Number.isSafeInteger(change.chapter_id)||typeof change.completed!=='boolean'||typeof change.material_name!=='string'||typeof change.chapter_name!=='string'||!expected||typeof expected.exists!=='boolean'||typeof expected.completed!=='boolean'||!(expected.updated_at===null||typeof expected.updated_at==='string'))throw fail(400,'取得時の教材・章・進捗が必要です。');
  const assigned='(SELECT COUNT(*) FROM student_materials WHERE name=? AND material_id=?)=1 AND EXISTS(SELECT 1 FROM student_materials sm JOIN materials m ON m.id=sm.material_id JOIN material_chapters c ON c.material_id=sm.material_id WHERE sm.id=? AND sm.name=? AND sm.material_id=? AND c.id=? AND c.name IS ? AND m.name IS ?)';
  const progress=expected.exists?'EXISTS(SELECT 1 FROM chapter_progress WHERE name=? AND chapter_id=? AND completed IS ? AND updated_at IS ?)':'NOT EXISTS(SELECT 1 FROM chapter_progress WHERE name=? AND chapter_id=?)';
  const values=[context.name,change.material_id,change.link_id,context.name,change.material_id,change.chapter_id,change.chapter_name,change.material_name,context.name,change.chapter_id,...(expected.exists?[expected.completed?1:0,expected.updated_at]:[])];
  statements.push(...snapshotGuard(env,assigned+' AND '+progress,values));
  statements.push(env.DB.prepare(`INSERT INTO chapter_progress(name,chapter_id,completed,updated_at) VALUES(?,?,?,?) ON CONFLICT(name,chapter_id) DO UPDATE SET completed=excluded.completed,updated_at=excluded.updated_at`).bind(context.name,change.chapter_id,change.completed?1:0,new Date().toISOString()));
 }
 await commitRecords(env,statements);await confirmSource(env,context);const saved=await materials(env,context.name);
 for(const change of body.changes){const chapter=saved.materials.find(row=>row.link_id===change.link_id)?.chapters.find(row=>row.chapter_id===change.chapter_id);if(!chapter||chapter.completed!==change.completed)throw fail(409,'保存後に進捗が変更されています。再送せず確認してください。');}
 return {target:context.target,name:context.name,...profileContextFields(context),record_revision:context.record_revision,...saved};
}

export {sourceContext as linkedSourceContext,writeContext as linkedWriteContext,confirmSource as linkedConfirmSource,snapshotGuard as linkedSnapshotGuard,materials as linkedMaterials};

export function profileContextFields(context){return {...(context.profile_context?{profile_context:context.profile_context}:{}),...(context.mapping?{mapping_id:context.mapping.id,mapping_revision:context.mapping.revision}:{})};}
