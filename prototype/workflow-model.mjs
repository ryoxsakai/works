// Browser-owner operations only. Execution/claim/lease/external dispatch APIs are absent.
export const workflowActions=new Set(['create','edit','publish','schedule_stop','archive','start','role_create','role_edit','role_archive','settings','stop_all','resume_all','pause','cancel','resume','approve','self_complete','plan_suggest','plan_apply','plan_update','stage_plan','rolling_preview','rolling_apply']);
export function safeWorkflowUrl(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}}
export function validWorkflowList(v){return !!v&&Array.isArray(v.definitions)&&Array.isArray(v.runs)&&(v.roles===null||Array.isArray(v.roles))&&Number.isSafeInteger(v.settings?.revision)&&[30,60].includes(v.settings.desired_interval)&&v.runs.every(r=>typeof r.id==='string'&&Number.isSafeInteger(r.revision)&&Array.isArray(r.data?.tasks))&&v.definitions.every(d=>typeof d.id==='string'&&Number.isSafeInteger(d.revision)&&Array.isArray(d.data?.tasks));}
export function assertWorkflowAck(body,value){
 const bad=()=>{throw Error('操作の保存応答を確認できません。再送せず最新状態を確認してください。');};
 if(!body||!workflowActions.has(body.action)||!value||typeof value!=='object')return bad();
 const a=body.action,version=key=>value.id===body[key]&&value.revision===body.revision+1;
 if(a.startsWith('rolling_')){if(value.mode!==(a==='rolling_apply'?'applied':'preview')||!Array.isArray(value.plans)||!Array.isArray(value.blocked)||(a==='rolling_apply'&&(!Array.isArray(value.updated)||!Array.isArray(value.conflicts))))return bad();}
 else if(a.startsWith('role_')){if(typeof value.id!=='string'||(body.role_id&&value.id!==body.role_id))return bad();}
 else if(a==='create'){if(typeof value.id!=='string'||value.enabled!==0||value.archived!==0||!Number.isSafeInteger(value.revision)||value.data?.title!==body.content.title.trim())return bad();}
 else if(['edit','publish','schedule_stop','archive'].includes(a)){if(!version('definition_id')||value.enabled!==(a==='publish'?1:0)||value.archived!==(a==='archive'?1:0)||(a==='edit'&&value.data?.title!==body.content.title.trim()))return bad();}
 else if(['settings','stop_all','resume_all'].includes(a)){if(value.revision!==body.revision+1||(a==='settings'&&value.desired_interval!==body.desired_interval)||(a!=='settings'&&value.stopped!==(a==='stop_all'?1:0)))return bad();}
 else if(a==='stage_plan'){if(value.definition_id!==body.definition_id||value.definition_revision!==body.definition_revision||value.scheduled_for!==body.scheduled_for||value.revision!==(body.stage_revision||0)+1||!value.data)return bad();}
 else if(a==='start'){if(typeof value.id!=='string'||value.definition_id!==body.definition_id||value.scheduled_for!=='manual:'+body.request_id||!value.data?.definition)return bad();}
 else if(!version('run_id')||!Array.isArray(value.data?.tasks))return bad();
 return value;
}
export function createWorkflowDialogs(root,{busy=()=>false}={}){
 const records=new Map(),saved=new WeakMap(),page=root.closest('.page-content');let overflow;
 const snapshot=d=>JSON.stringify([...d.querySelectorAll('input:not([data-immediate]),select:not([data-immediate]),textarea:not([data-immediate])')].map(e=>[e.name||e.id,e.type==='checkbox'?e.checked:e.multiple?[...e.selectedOptions].map(o=>o.value):e.value]));
 const dirty=d=>saved.has(d)&&saved.get(d)!==snapshot(d);
 function markDialogSaved(d){saved.set(d,snapshot(d));}
 function restoreScroll(){if(page&&![...records.keys()].some(d=>d.open))page.style.overflow=overflow||'';}
 function closeDialog(d){if(d.open&&dirty(d)&&!confirm('未保存の編集があります。閉じると今回の入力を破棄します。閉じますか？'))return false;const opener=records.get(d);records.delete(d);d.close();restoreScroll();(opener?.isConnected?opener:[...root.querySelectorAll('dialog[open] button')].at(-1))?.focus();return true;}
 async function showDialog(d,canOpen=()=>true){if(d.open||!canOpen())return;if(![...records.keys()].some(x=>x.open)&&page){overflow=page.style.overflow;page.style.overflow='hidden';}records.set(d,document.activeElement);if(!d.dataset.nativeBound){d.dataset.nativeBound='true';d.addEventListener('cancel',e=>{e.preventDefault();if(!busy())closeDialog(d);});d.addEventListener('close',restoreScroll);}markDialogSaved(d);d.showModal();}
 return {showDialog,closeDialog,markDialogSaved,dirty:()=>[...records.keys()].some(dirty),dispose(){for(const d of records.keys())d.close();records.clear();restoreScroll();}};
}
