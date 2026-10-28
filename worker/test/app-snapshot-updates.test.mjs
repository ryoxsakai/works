import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

async function loadFunctions(){
 let source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
 for(const file of ['workflow.js','wiki.js','kdp-services.js','mcp-scopes.js','oauth-refresh.js'])source=source.replace('./'+file,new URL('../src/'+file,import.meta.url).href);
 source+='\nexport {createSessionToken,guardedUpdateInput,ensureAdmissionSchema,ensureMaterialSchema,updateAdmissionEvent,updateMaterialFolder,updateMaterialFile};';
 return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
test('optional snapshot updates are atomic, null-safe and preserve old request contracts without schema changes',async t=>{
 const functions=await loadFunctions();assert.throws(()=>functions.guardedUpdateInput(['path','id','/guarded'],{}),{status:400});assert.deepEqual(functions.guardedUpdateInput(['path','id'],{name:'legacy'}),{name:'legacy'});
 const mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:'2026-08-01',d1Databases:{DB:'app-snapshot',MATERIALS_DB:'app-material'}});
 t.after(()=>mf.dispose());const env={DB:await mf.getD1Database('DB'),MATERIALS_DB:await mf.getD1Database('MATERIALS_DB')};
 await functions.ensureAdmissionSchema(env);await functions.ensureMaterialSchema(env);
 env.ALLOWED_EMAIL='owner@example.test';env.SESSION_SECRET='synthetic-stage3-secret';env.ALLOWED_ORIGIN='https://works.example.test';
 const db=env.DB,material=env.MATERIALS_DB;
 await db.prepare("INSERT INTO admission_events(id,university,selection_type,stage,schedule_date,source_url,color) VALUES('a','Synthetic University','general','primary','2027-02-01','https://example.test','blue')").run();
 await material.prepare("INSERT INTO material_folders(id,name,parent_id,sort_order) VALUES('folder','Synthetic',NULL,0)").run();
 await material.prepare("INSERT INTO material_files(id,name,object_key,material_code,folder_id,sort_order,mime_type,size) VALUES('file','Synthetic.pdf','private-object','CODE','folder',0,'application/pdf',100)").run();
 const fields={admission:['university','selection_type','stage','schedule_date','end_date','notes','source_url','color'],folders:['name','parent_id','sort_order'],files:['name','material_code','folder_id','sort_order']};
 const expected=(keys,row)=>Object.fromEntries(keys.map(key=>[key,row[key]]));
 const admission=await db.prepare("SELECT * FROM admission_events WHERE id='a'").first();
 const base=expected(fields.admission,admission);
 const outcomes=await Promise.allSettled([functions.updateAdmissionEvent(env,'a',{notes:'one',expected:base}),functions.updateAdmissionEvent(env,'a',{notes:'two',expected:base})]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(outcomes.find(r=>r.status==='rejected').reason.status,409);
 const token=await functions.createSessionToken(env,env.ALLOWED_EMAIL);
 const request=async(path,method,body)=>functions.default.fetch(new Request(env.ALLOWED_ORIGIN+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:env.ALLOWED_ORIGIN},...(body?{body:JSON.stringify(body)}:{})}),env,{});
 assert.equal((await request('/api/admissions/a/guarded','PUT',{notes:'missing expected'})).status,400);
 assert.equal((await request('/api/material-library/files/file/guarded','PUT',{name:'missing expected'})).status,400);
 assert.equal((await request('/api/material-library/folders/folder/guarded','PUT',{name:'missing expected'})).status,400);
 assert.equal((await request('/api/admissions/a/guarded','DELETE')).status,404);
 assert.equal((await request('/api/material-library/files/file/guarded','DELETE')).status,404);
 assert.equal((await request('/api/material-library/folders/folder/guarded','DELETE')).status,404);
 const after=await db.prepare("SELECT * FROM admission_events WHERE id='a'").first();assert.equal(after.source_url,admission.source_url);assert.equal(after.color,'blue');assert.equal(after.end_date,null);
 await assert.rejects(functions.updateAdmissionEvent(env,'a',{notes:'stale',expected:base}),{status:409});
 await assert.rejects(functions.updateAdmissionEvent(env,'a',{notes:'bad',expected:{}}),{status:400});
 assert.equal((await functions.updateAdmissionEvent(env,'a',{notes:'legacy'})).notes,'legacy');
 const latest=await db.prepare("SELECT * FROM admission_events WHERE id='a'").first();assert.equal((await request('/api/admissions/a/guarded','PUT',{notes:'HTTP guarded',expected:expected(fields.admission,latest)})).status,200);assert.equal((await request('/api/admissions/a/guarded','PUT',{notes:'HTTP stale',expected:expected(fields.admission,latest)})).status,409);
 for(const [table,id,keys,fn]of [['material_files','file',fields.files,functions.updateMaterialFile],['material_folders','folder',fields.folders,functions.updateMaterialFolder]]){
  const before=await material.prepare('SELECT * FROM '+table+' WHERE id=?').bind(id).first(),snapshot=expected(keys,before);
  const results=await Promise.allSettled([fn(env,id,{name:'First',expected:snapshot}),fn(env,id,{name:'Second',expected:snapshot})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  await assert.rejects(fn(env,id,{name:'Invalid',expected:{name:before.name}}),{status:400});
  const legacy=await fn(env,id,{name:'Legacy'});assert.equal(legacy.name,'Legacy');if(table==='material_files'){assert.equal(legacy.object_key,'private-object');assert.equal(legacy.mime_type,'application/pdf');assert.equal(legacy.size,100);assert.equal(legacy.material_code,'CODE');}else assert.equal(legacy.parent_id,null);
 }
});
