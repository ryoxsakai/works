// Device recovery copy only; successful persistence is always acknowledged by D1.
const prefix='works_pending_plan_draft_v1:';
let tabId;
function storageKey(context){if(!tabId){if(typeof sessionStorage==='undefined')tabId='local';else{tabId=sessionStorage.getItem('works_pending_plan_tab');if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem('works_pending_plan_tab',tabId);}}}return prefix+context+':'+tabId;}
export function readPendingRecovery(context){try{return typeof localStorage==='undefined'?null:JSON.parse(localStorage.getItem(storageKey(context))||'null');}catch{return null;}}
export function persistPendingRecovery(state){
 if(!state.pendingContext)return;
 try{if(typeof localStorage==='undefined')return;localStorage.setItem(storageKey(state.pendingContext),JSON.stringify({context:state.pendingContext,target:state.target,value:state.value,base:state.base,recordRevision:state.recordRevision,operationId:state.operationId||null,sentValue:state.sentValue,unknown:!!state.pendingUnknown}));state.recoveryUnavailable=false;}catch{state.recoveryUnavailable=true;}
}
export function clearPendingRecovery(state){if(!state.pendingContext)return;state.recoveryUnavailable=false;try{if(typeof localStorage!=='undefined')localStorage.removeItem(storageKey(state.pendingContext));}catch{}}
export function pendingRecoveryCopies(){
 try{if(typeof localStorage==='undefined')return [];storageKey('');const result=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;try{const draft=JSON.parse(localStorage.getItem(key));if(draft?.context&&draft.target&&typeof draft.value==='string')result.push({...draft,currentTab:key.endsWith(':'+tabId)});}catch{}}return result;}catch{return [];}
}
