import {materialSnapshot} from '../worker/src/material-library-guarded.js';
export function validateMaterialListing(value){for(const kind of ['folders','files']){const rows=value?.[kind];if(!Array.isArray(rows)||new Set(rows.map(r=>r?.id)).size!==rows.length)throw Error('教材一覧の応答を確認できません。');for(let i=0;i<rows.length;i+=2000)materialSnapshot({folders:[],files:[],[kind]:rows.slice(i,i+2000)});}return value;}
export function assertMaterialAck(body,value){
 const bad=()=>{throw Error('教材の保存応答を確認できません。再送せず最新を確認してください。');};
 if(value?.ok!==true||value.op!==body.op||!Array.isArray(value.affected)||!value.affected.length)return bad();
 const kind=body.op.startsWith('folder_')?'folders':'files',rows=body.expected[kind],target=rows.find(r=>r.id===body.id),ids=body.order||[body.id],affected=value.affected;
 if(body.op==='folder_create'){const r=affected[0];if(affected.length!==1||typeof r.id!=='string'||rows.some(old=>old.id===r.id)||r.name!==body.name.trim()||(r.parent_id||null)!==(body.parent_id||null))return bad();return value;}
 if(!target||affected.length!==ids.length||new Set(affected.map(r=>r.id)).size!==ids.length||affected.some(r=>!ids.includes(r.id)))return bad();
 const parent=kind==='folders'?'parent_id':'folder_id';
 for(const row of affected){const old=rows.find(r=>r.id===row.id);if(!old)return bad();if(body.op.endsWith('_delete')){if(JSON.stringify(materialSnapshot({folders:[],files:[],[kind]:[row]})[kind])!==JSON.stringify(materialSnapshot({folders:[],files:[],[kind]:[old]})[kind]))return bad();continue;}
 for(const [key,previous]of Object.entries(old)){if(['folder_count','file_count'].includes(key))continue;let expected=previous;
 if(row.id===body.id){if(key==='name'&&body.name!==undefined)expected=body.name.trim();if(key===parent&&Object.hasOwn(body,parent))expected=body[parent]||null;if(key==='material_code'&&body.material_code!==undefined)expected=body.material_code.trim();}
 if(key==='sort_order'){if(body.order)expected=body.order.indexOf(row.id);else if(row.id===body.id&&Object.hasOwn(body,parent)&&(old[parent]||null)!==(body[parent]||null))continue;}
 if(row[key]!==expected)return bad();}
 }
 if(body.op==='file_delete'&&!['confirmed','uncertain'].includes(value.blob_cleanup))return bad();return value;
}
export function assertMaterialUpload(file,folderId,row){if(!row||typeof row.id!=='string'||!row.id||row.object_key!=='materials/'+row.id||row.name!==file.name.trim()||(row.folder_id||null)!==folderId||row.size!==file.size)throw Error('アップロードの応答を確認できません');return row;}
