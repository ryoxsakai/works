// Native library mutations compare the complete metadata graph atomically.
// No schema, identity, bucket key or legacy route is changed by deployment.
const fields={folders:['id','name','parent_id','sort_order','created_at'],files:['id','name','folder_id','object_key','mime_type','size','material_code','sort_order','created_at']};
const fail=(status,message)=>{throw Object.assign(Error(message),{status,material_guard_error:true});};
export const materialSnapshot=(data)=>Object.fromEntries(Object.entries(fields).map(([kind,keys])=>{
 const rows=data?.[kind];if(!Array.isArray(rows)||rows.length>2000)fail(400,'complete material snapshot required (maximum 2000 per kind)');
 const ids=new Set();return [kind,rows.map(row=>{if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id))fail(400,'unique material snapshot IDs required');ids.add(row.id);return keys.map(k=>{if(!Object.hasOwn(row,k)||!(row[k]===null||typeof row[k]==='string'||typeof row[k]==='number'&&Number.isFinite(row[k])))fail(400,'complete material snapshot fields required');return row[k];});}).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)];
}));
export async function readMaterialSnapshot(db){const [folders,files]=await Promise.all([db.prepare('SELECT * FROM material_folders ORDER BY id').all(),db.prepare('SELECT * FROM material_files ORDER BY id').all()]);return {folders:folders.results,files:files.results};}
function statementPrefix(expected){const sql=Object.entries(fields).map(([kind,keys])=>`(SELECT json_group_array(json_array(${keys.join(',')})) FROM (SELECT ${keys.join(',')} FROM material_${kind} ORDER BY id)) = ?`).join(' AND ');return {sql:'WITH material_guard AS MATERIALIZED (SELECT '+sql+' AS ok) ',args:[JSON.stringify(expected.folders),JSON.stringify(expected.files)]};}
const text=(value,max)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)fail(400,'invalid material name');return value.trim();};
const permutation=(ids,order)=>Array.isArray(order)&&order.length===ids.length&&new Set(order).size===ids.length&&order.every(id=>ids.includes(id));
export async function mutateMaterialLibrary(env,body,{beforeCommit}={}){
 const db=env.MATERIALS_DB;if(!db)fail(503,'MATERIALS_DB binding required');
 if(!body||!['folder_create','folder_update','file_update','folder_delete','file_delete'].includes(body.op))fail(400,'unsupported material operation');
 const expected=materialSnapshot(body.expected),current=await readMaterialSnapshot(db);
 if(JSON.stringify(materialSnapshot(current))!==JSON.stringify(expected))fail(409,'material metadata changed; reload before saving');
 const folder=id=>current.folders.find(r=>r.id===id),op=body.op;
 const target=op.startsWith('folder')?folder(body.id):current.files.find(r=>r.id===body.id);
 if(op!=='folder_create'&&!target)fail(409,'material target removed');
 const prefix=statementPrefix(expected);let query,args;
 if(op==='folder_create'){
  const name=text(body.name,120),parent=body.parent_id||null;if(parent&&!folder(parent))fail(409,'material destination removed');
  if(current.folders.some(r=>r.name===name&&(r.parent_id||null)===parent))fail(400,'same-name folder already exists');
  const rank=Math.max(-1,...current.folders.filter(r=>(r.parent_id||null)===parent).map(r=>r.sort_order??-1))+1,id=crypto.randomUUID();
  query='INSERT INTO material_folders(id,name,parent_id,sort_order) SELECT ?,?,?,? WHERE (SELECT ok FROM material_guard)=1 RETURNING *';args=[id,name,parent,rank];
 }else if(op.endsWith('_delete')){
  if(op==='folder_delete'&&(current.folders.some(r=>r.parent_id===target.id)||current.files.some(r=>r.folder_id===target.id)))fail(400,'nonempty folder cannot be deleted');
  query=`DELETE FROM material_${op.startsWith('folder')?'folders':'files'} WHERE id=? AND (SELECT ok FROM material_guard)=1 RETURNING *`;args=[target.id];
 }else{
  const isFolder=op==='folder_update',kind=isFolder?'folders':'files',parentKey=isFolder?'parent_id':'folder_id',parent=Object.hasOwn(body,parentKey)?body[parentKey]||null:target[parentKey]||null,name=body.name===undefined?target.name:text(body.name,isFolder?120:255);
  if(parent&&!folder(parent))fail(409,'material destination removed');
  if(isFolder){const seen=new Set();let at=parent;while(at){if(at===target.id||seen.has(at))fail(400,'folder cycle is not allowed');seen.add(at);at=folder(at)?.parent_id||null;}if(current.folders.some(r=>r.id!==target.id&&r.name===name&&(r.parent_id||null)===parent))fail(400,'same-name folder already exists');}
  const siblings=current[kind].filter(r=>r.id!==target.id&&(r[parentKey]||null)===parent),ids=[...siblings.map(r=>r.id),target.id];
  if(body.order!==undefined&&!permutation(ids,body.order))fail(409,'complete material sibling order required');
  const rank=body.order?body.order.indexOf(target.id):(target[parentKey]||null)===parent?target.sort_order:Math.max(-1,...siblings.map(r=>r.sort_order??-1))+1;
  let code=target.material_code;if(!isFolder&&body.material_code!==undefined){if(typeof body.material_code!=='string'||body.material_code.trim().length>64)fail(400,'material code must be at most 64 characters');code=body.material_code.trim();}
  const rows=body.order?body.order:[target.id],rankSql=body.order?`(SELECT CAST(key AS INTEGER) FROM json_each(?) WHERE value=material_${kind}.id)`:'CASE WHEN id=? THEN ? ELSE sort_order END';
  query=`UPDATE material_${kind} SET name=CASE WHEN id=? THEN ? ELSE name END,${parentKey}=CASE WHEN id=? THEN ? ELSE ${parentKey} END,sort_order=${rankSql}`;
  args=[target.id,name,target.id,parent,...(body.order?[JSON.stringify(body.order)]:[target.id,rank])];
  if(!isFolder){query+=',material_code=CASE WHEN id=? THEN ? ELSE material_code END';args.push(target.id,code);}
  query+=' WHERE id IN (SELECT value FROM json_each(?)) AND (SELECT ok FROM material_guard)=1 RETURNING *';args.push(JSON.stringify(rows));
 }
 await beforeCommit?.();const result=await db.prepare(prefix.sql+query).bind(...prefix.args,...args).all();
 if(!result.results.length)fail(409,'material metadata changed while saving');
 let blob_cleanup=null;if(op==='file_delete'){try{if(!env.MATERIALS_BUCKET)throw Error('bucket unavailable');await env.MATERIALS_BUCKET.delete(target.object_key);blob_cleanup='confirmed';}catch{blob_cleanup='uncertain';}}
 return {ok:true,op,affected:result.results,blob_cleanup};
}
