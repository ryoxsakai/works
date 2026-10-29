import {profileContextFields,linkedSourceContext,linkedWriteContext,linkedConfirmSource,linkedSnapshotGuard,linkedMaterials} from './teaching-linked.js';
import {guardStatements,commitRecords} from './lesson-attribution.js';
import {PRIVATE_MED_SCHOOLS,goalCategories} from '../../shared/student-planning-catalog.js';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const definitions={
 goals:{table:'goals',fields:['id','category','text','completed','sort_order','created_at'],scoped:true},
 templates:{table:'goal_templates',fields:['id','category','text','sort_order','created_at'],scoped:false},
 schools:{table:'candidate_schools',fields:['id','school_name','school_type','rank','created_at'],scoped:true},
 materials:{table:'student_materials',fields:['id','material_id','sort_order','created_at'],scoped:true},
};
function definition(resource){if(!Object.hasOwn(definitions,resource))throw fail(400,'情報の種類を確認してください。');return definitions[resource];}
const positive=value=>Number.isSafeInteger(value)&&value>0;
const text=value=>{if(typeof value!=='string'||!value.trim())throw fail(400,'空欄を確認してください。');return value.trim();};
function canonicalRows(def,rows){if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||def.fields.some(field=>!Object.hasOwn(row,field)))||new Set(rows.map(row=>row.id)).size!==rows.length)throw fail(400,'取得時の一覧が必要です。');return [...rows].sort((a,b)=>a.id-b.id).map(row=>Object.fromEntries(def.fields.map(field=>[field,row[field]])));}
async function rows(env,resource,name){const def=definition(resource),query=env.DB.prepare(`SELECT ${def.fields.join(',')} FROM ${def.table}${def.scoped?' WHERE name=?':''} ORDER BY id`);return (await (def.scoped?query.bind(name):query).all()).results;}
function listGuard(env,resource,name,expected){const def=definition(resource),snapshot=JSON.stringify(canonicalRows(def,expected));const json=def.fields.map(field=>`'${field}',${field}`).join(',');const select=`SELECT COALESCE(json_group_array(json_object(${json})),'[]') FROM (SELECT ${def.fields.join(',')} FROM ${def.table}${def.scoped?' WHERE name=?':''} ORDER BY id)`;return linkedSnapshotGuard(env,`(${select}) IS ?`,[...(def.scoped?[name]:[]),snapshot]);}
function selected(before,id){if(!positive(id))throw fail(400,'項目を確認してください。');const row=before.find(row=>row.id===id);if(!row)throw fail(409,'項目の所属・一覧が変更されています。');return row;}
function orderRows(before,ids){if(!Array.isArray(ids)||ids.length!==before.length||new Set(ids).size!==ids.length||ids.some(id=>!positive(id)||!before.some(row=>row.id===id)))throw fail(400,'取得した全項目の順序が必要です。');return ids;}
function category(value){if(!goalCategories.includes(value))throw fail(400,'短期・中期・長期の区分を確認してください。');return value;}
function nextOrder(before,kind){return Math.max(-1,...before.filter(row=>!kind||row.category===kind).map(row=>Number(row.sort_order)||0))+1;}
const equalRows=(resource,a,b)=>JSON.stringify(canonicalRows(definition(resource),a))===JSON.stringify(canonicalRows(definition(resource),b));
async function readValue(env,context,resource){const value={rows:await rows(env,resource,context.name)};if(resource==='materials'){const [catalog,categories,progress]=await Promise.all([env.DB.prepare('SELECT id,name,category_id,sort_order FROM materials ORDER BY sort_order,id').all(),env.DB.prepare('SELECT id,name,sort_order FROM material_categories ORDER BY sort_order,id').all(),linkedMaterials(env,context.name)]);Object.assign(value,{catalog:catalog.results,categories:categories.results,...progress});}return value;}
function response(context,resource,value){return {target:context.target,name:context.name,...profileContextFields(context),record_revision:context.record_revision,resource,...value};}
export async function readStudentPlanning(env,input,deps){const resource=input?.resource;definition(resource);const context=await linkedSourceContext(env,input,deps),value=await readValue(env,context,resource);await linkedConfirmSource(env,context);if(!equalRows(resource,value.rows,await rows(env,resource,context.name)))throw fail(409,'取得中に一覧が変更されました。再読み込みしてください。');return response(context,resource,value);}
export async function writeStudentPlanning(env,body,deps){
 const resource=body?.resource,def=definition(resource),context=await linkedSourceContext(env,body?.target,deps,true,body);linkedWriteContext(context,body);
 if(resource==='templates'&&body.shared_catalog_acknowledged!==true)throw fail(400,'全生徒に共通するテンプレートへの変更を確認してください。');
 const expected=canonicalRows(def,body.expected),before=await rows(env,resource,context.name),action=body.action;if(!action||typeof action.type!=='string')throw fail(400,'操作を確認してください。');
 const statements=[...guardStatements(env,context.target.id,body.record_revision),...context.mapping_guards,...listGuard(env,resource,context.name,expected)];
 const bind=(sql,...values)=>env.DB.prepare(sql).bind(...values);
 if(resource==='goals'||resource==='templates'){
  const scoped=resource==='goals',table=def.table;
  if(action.type==='add'){const kind=category(action.category),value=text(action.text),sort=nextOrder(before,kind);statements.push(scoped?bind('INSERT INTO goals(name,category,text,completed,sort_order) VALUES(?,?,?,0,?)',context.name,kind,value,sort):bind('INSERT INTO goal_templates(category,text,sort_order) VALUES(?,?,?)',kind,value,sort));}
  else if(action.type==='copy_template'&&scoped){const template=action.template;if(!template||!positive(template.id))throw fail(400,'取得したテンプレートを確認してください。');const kind=category(template.category),value=text(template.text);statements.push(...linkedSnapshotGuard(env,'EXISTS(SELECT 1 FROM goal_templates WHERE id=? AND category IS ? AND text IS ? AND sort_order IS ? AND created_at IS ?)',[template.id,kind,template.text,template.sort_order,template.created_at]));statements.push(bind('INSERT INTO goals(name,category,text,completed,sort_order) VALUES(?,?,?,0,?)',context.name,kind,value,nextOrder(before,kind)));}
  else if(action.type==='edit'){const row=selected(before,action.id);statements.push(scoped?bind('UPDATE goals SET text=? WHERE id=? AND name=?',text(action.text),row.id,context.name):bind('UPDATE goal_templates SET text=? WHERE id=?',text(action.text),row.id));}
  else if(action.type==='complete'&&scoped){const row=selected(before,action.id);if(typeof action.completed!=='boolean')throw fail(400,'完了の値を確認してください。');statements.push(bind('UPDATE goals SET completed=? WHERE id=? AND name=?',action.completed?1:0,row.id,context.name));}
  else if(action.type==='remove'){const row=selected(before,action.id);statements.push(scoped?bind('DELETE FROM goals WHERE id=? AND name=?',row.id,context.name):bind('DELETE FROM goal_templates WHERE id=?',row.id));}
  else if(action.type==='reorder'){const kind=category(action.category),group=before.filter(row=>row.category===kind),ids=orderRows(group,action.order);ids.forEach((id,index)=>statements.push(scoped?bind('UPDATE goals SET sort_order=? WHERE id=? AND name=?',index,id,context.name):bind('UPDATE goal_templates SET sort_order=? WHERE id=?',index,id)));}
  else throw fail(400,'目標の操作を確認してください。');
 }else if(resource==='schools'){
  if(action.type==='add'){if(!['private','national'].includes(action.school_type))throw fail(400,'学校の区分を確認してください。');const school=text(action.school_name);if(action.school_type==='private'&&!PRIVATE_MED_SCHOOLS.includes(school))throw fail(400,'元の私立医学部リストから選択してください。');if(before.some(row=>row.school_name===school&&row.school_type===action.school_type))throw fail(409,'既に登録されています。一覧を確認してください。');statements.push(bind('INSERT INTO candidate_schools(name,school_name,school_type) VALUES(?,?,?)',context.name,school,action.school_type));}
  else if(action.type==='remove'){const row=selected(before,action.id);statements.push(bind('DELETE FROM candidate_schools WHERE id=? AND name=?',row.id,context.name));}
  else if(action.type==='rank'){if(![1,2,3].includes(action.rank))throw fail(400,'第1〜3志望を選択してください。');if(action.id!==null)selected(before,action.id);statements.push(bind('UPDATE candidate_schools SET rank=NULL WHERE name=? AND rank=?',context.name,action.rank));if(action.id!==null)statements.push(bind('UPDATE candidate_schools SET rank=? WHERE name=? AND id=?',action.rank,context.name,action.id));}
  else throw fail(400,'受験校の操作を確認してください。');
 }else {
  if(action.type==='add'){const material=action.material;if(!material||!positive(material.id)||typeof material.name!=='string')throw fail(400,'取得した教材を選択してください。');if(before.some(row=>row.material_id===material.id))throw fail(409,'既に使用教材に登録されています。');statements.push(...linkedSnapshotGuard(env,'EXISTS(SELECT 1 FROM materials WHERE id=? AND name IS ? AND category_id IS ?)',[material.id,material.name,material.category_id??null]));statements.push(bind('INSERT INTO student_materials(name,material_id,sort_order) VALUES(?,?,?)',context.name,material.id,nextOrder(before)));}
  else if(action.type==='remove'){const row=selected(before,action.id);statements.push(bind('DELETE FROM student_materials WHERE id=? AND name=?',row.id,context.name));}
  else if(action.type==='reorder'){orderRows(before,action.order).forEach((id,index)=>statements.push(bind('UPDATE student_materials SET sort_order=? WHERE id=? AND name=?',index,id,context.name)));}
  else throw fail(400,'使用教材の操作を確認してください。');
 }
 statements.push(def.scoped?bind(`SELECT ${def.fields.join(',')} FROM ${def.table} WHERE name=? ORDER BY id`,context.name):env.DB.prepare(`SELECT ${def.fields.join(',')} FROM ${def.table} ORDER BY id`));
 const committed=await commitRecords(env,statements),acknowledged=committed.at(-1).results;await linkedConfirmSource(env,context);const value=await readValue(env,context,resource);if(!equalRows(resource,acknowledged,value.rows))throw fail(409,'保存後に一覧が変更されています。再送せず最新を確認してください。');return response(context,resource,value);
}
