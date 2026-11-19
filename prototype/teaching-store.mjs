import {studentProfileName,studentProfileFields,studentProfileQuery} from '../shared/student-profile-key.js';
import {lessonEventKey,sameLessonEvent} from '../shared/lesson-plan.js';
import {currentLessonRecord,recordFields,recordPayload} from './teaching-model.mjs';
const clone=value=>structuredClone(value),error=(message,status=409)=>Object.assign(new Error(message),{status});
const fields=['completed',...recordFields.map(([key])=>key)];
// Tutor's view-independent draft model, extended with guarded snapshots and a single
// queue per destination. A current plan and its preceding lesson's next input own one draft.
export function createTeachingStore({api}){
 const records=new Map(),profiles=new Map(),listeners=new Set();let disposed=false;
 const notify=()=>{if(!disposed)for(const callback of [...listeners])callback();};
 const live=()=>{if(disposed)throw new DOMException('Teaching view closed','AbortError');};
 const key=ref=>lessonEventKey(ref);
 const changed=state=>fields.some(field=>state.draft[field]!==state.base[field]);
 function getRecord(ref){return records.get(key(ref));}
 function seedRecord(ref,row,{force=false}={}){
  live();const value=currentLessonRecord(row);let state=getRecord(ref);if(!value){if(state){state.blocked=true;state.unavailable=true;notify();}throw error('記録の対応確認が必要です。');}if(state&&!sameLessonEvent(state.ref,ref)&&(state.dirty||state.busy)){state.blocked=true;state.unavailable=true;notify();throw error('授業予定が変更されています。入力は保持しています。');}
  if(state?.blocked&&!force){notify();return state;}
  if(!state){state={ref:clone(ref),base:clone(value),draft:clone(value),dirty:false,busy:false,blocked:false,status:'ready',epoch:0,version:0,fieldOwners:{},queue:[],run:null};records.set(key(ref),state);}
  else if(!state.busy&&(force||!state.dirty)){
   if(value.record_revision<state.base.record_revision){if(force)throw error('読み込み中に授業記録が更新されました。再確認してください。');return state;}
   if(!sameLessonEvent(ref,state.ref)||value.record_revision!==state.base.record_revision)state.epoch++;
   Object.assign(state,{ref:clone(ref),base:clone(value),draft:clone(value),fieldOwners:{},dirty:false,blocked:false,unavailable:false,status:'ready',error:null});state.version++;
  }
  if(!force&&state.dirty&&!state.busy&&value.record_revision>state.base.record_revision){state.blocked=true;state.status='conflict';state.error=error('別の画面で授業記録が更新されました。');}notify();return state;
 }
 async function loadRecord(ref,{force=false}={}){const state=getRecord(ref);if(force&&state?.busy)throw error('保存完了を待ってください。');if(force&&state){state.refreshing=true;notify();}try{const response=await api('/api/lesson-record?'+new URLSearchParams({calendar_id:ref.calendar_id,event_id:ref.id}));live();if(!sameLessonEvent(ref,response.target))throw error('授業予定が変更されています。');return seedRecord(ref,response.record,{force});}finally{if(force&&state){state.refreshing=false;notify();}}}
 function editRecord(ref,input,{origin}={}){live();const state=getRecord(ref);if(!state||state.refreshing||!sameLessonEvent(state.ref,ref))throw error('授業記録を読み直してください。');for(const field of fields)if(field in input&&state.draft[field]!==input[field]){state.draft[field]=input[field];state.fieldOwners[field]=origin||null;}state.dirty=changed(state);if(!state.blocked)state.status=state.busy?'saving':state.dirty?'unsaved':'ready';notify();return state;}
 async function saveRecord(ref,{source,sourceEpoch,planOnly=false,fields:requestedFields=fields}={}){
  live();const state=getRecord(ref);if(!state||state.blocked||state.refreshing)throw error('保存を停止しています。');if(!sameLessonEvent(state.ref,ref))throw error('保存先が変更されています。');
  const intent={draft:clone(state.draft),planOnly:!!planOnly,fields:requestedFields,source:source?clone(source):null,sourceEpoch:source?(sourceEpoch??getRecord(source)?.epoch):null};state.queue.push(intent);
  if(state.run)return state.run;
  state.busy=true;notify();state.run=Promise.resolve().then(async()=>{try{
   while(state.queue.length){live();if(state.blocked||state.unavailable)throw error('授業記録の対応確認が必要です。');const next=state.queue.shift();const isPlan=!!next.source||next.planOnly;if(isPlan?next.draft.lesson_plan===state.base.lesson_plan:!next.fields.some(field=>next.draft[field]!==state.base[field]))continue;
    const base=clone(state.base),draft=clone(next.draft),target=clone(state.ref);
    let path,body;
    if(isPlan){if(next.source&&key(next.source)===key(target))throw error('次回授業の対象を確認してください。');const owner=next.source?getRecord(next.source):null;if(owner?.run)await owner.run;live();if(next.source&&(!owner||owner.blocked||owner.epoch!==next.sourceEpoch||!sameLessonEvent(owner.ref,next.source)))throw error('元の授業が変更されています。');if(draft.lesson_plan.length>5000)throw Object.assign(error('授業予定は5000文字以内で入力してください。',400),{validation:true});path='/api/lesson-plan';body={...(next.source?{source:next.source}:{}),target,record_revision:base.record_revision,expected_lesson_plan:base.lesson_plan,lesson_plan:draft.lesson_plan};}
    else{path='/api/curriculum/'+encodeURIComponent(target.id);try{body=recordPayload(target,base,{...base,...Object.fromEntries(next.fields.map(field=>[field,draft[field]]))});}catch(cause){throw Object.assign(cause,{status:400,validation:true});}}
    const response=await api(path,{method:'PUT',body});live();let saved;
    if(isPlan){if(!currentLessonRecord({...base,...response})||!Number.isSafeInteger(response.record_revision)||response.lesson_plan!==draft.lesson_plan)throw error('保存応答を確認できません。',500);saved={...base,lesson_plan:response.lesson_plan,record_revision:response.record_revision,attribution_status:response.attribution_status};}
    else{saved=currentLessonRecord(response);if(!saved)throw error('保存応答を確認できません。',500);}
    if(saved.record_revision<=base.record_revision)throw error('保存リビジョンを確認できません。',500);
    const written=isPlan?['lesson_plan']:next.fields;state.base=clone(saved);for(const field of written)if(state.draft[field]===draft[field])state.draft[field]=saved[field];state.draft.record_revision=saved.record_revision;state.dirty=changed(state);state.version++;state.status=state.dirty?'unsaved':'saved';notify();
   }
  }catch(cause){state.blocked=!cause.validation;state.error=cause;state.status=cause.validation?'validation':cause.status===409?'conflict':'unknown';state.queue=[];notify();throw cause;}finally{state.busy=false;state.run=null;if(!state.blocked&&!['validation','acknowledgement'].includes(state.status))state.status=state.dirty?'unsaved':state.version?'saved':'ready';notify();}});
  return state.run;
 }
 function profile(name){if(!profiles.has(name))profiles.set(name,{name,loaded:false,base:null,value:'',dirty:false,busy:false,blocked:false,ack:false,status:'idle',version:0,queue:[],run:null,lock:null});return profiles.get(name);}
 function seedProfile(ref,response,readVersion,binding,force=false){
  live();if(!sameLessonEvent(ref,response.target)||response.name!==studentProfileName(ref,binding)||(binding&&response.profile_context!=='curriculum')||!response.profile||typeof response.profile.exists!=='boolean')throw error('生徒情報の対応を確認できません。');const state=profile(response.name);if(state.blocked&&!force){notify();return state;}
  if(!state.busy&&!state.dirty&&(readVersion===undefined||readVersion===state.version)){state.loaded=true;state.base=clone(response.profile);state.value=response.profile.memo||'';state.blocked=false;state.status='ready';state.version++;notify();}return state;
 }
 async function loadProfile(ref,binding){const state=profile(studentProfileName(ref,binding)),version=state.version;const response=await api('/api/student-prefs/guarded?'+studentProfileQuery(ref,binding));return seedProfile(ref,response,version,binding);}
 function editMemo(ref,value,binding){live();const state=profile(studentProfileName(ref,binding));if(!state.loaded||state.lock||state.refreshing)throw error('生徒情報を確認してください。');state.value=value;state.dirty=value!==(state.base.memo||'');if(!state.blocked)state.status=state.busy?'saving':state.dirty?'unsaved':'ready';notify();}
 function acknowledgeMemo(ref,value,binding){const state=profile(studentProfileName(ref,binding));state.ack=value===true;notify();}
 async function saveMemo(ref,{sourceEpoch,binding}={}){
  live();const state=profile(studentProfileName(ref,binding)),owner=getRecord(ref);if(!state.loaded||state.blocked||state.lock||state.refreshing||!owner||owner.blocked||owner.refreshing||(sourceEpoch!==undefined&&sourceEpoch!==owner.epoch))throw error('生徒メモの保存を停止しています。');if(!state.dirty&&!state.busy)return;if(!state.ack){state.status='acknowledgement';notify();return;}if(state.value.length>20000){state.status='validation';notify();return;}
  state.queue.push({ref:clone(ref),epoch:owner.epoch,raw:state.value,binding:clone(binding)});if(state.run)return state.run;
  state.busy=true;notify();state.run=Promise.resolve().then(async()=>{try{
   while(state.queue.length){live();if(!state.ack){state.queue=[];state.status='acknowledgement';break;}const intent=state.queue.shift();if((intent.raw.trim()||null)===state.base.memo){if(state.value===intent.raw)state.value=state.base.memo||'';state.dirty=state.value!==(state.base.memo||'');continue;}const source=getRecord(intent.ref);if(source?.run)await source.run;live();if(!source||source.blocked||source.epoch!==intent.epoch||!sameLessonEvent(source.ref,intent.ref))throw error('元の授業が変更されています。');
    const raw=intent.raw,memo=raw.trim()||null,response=await api('/api/student-prefs/guarded',{method:'PUT',body:{target:intent.ref,name:state.name,...studentProfileFields(intent.binding),record_revision:source.base.record_revision,shared_name_acknowledged:true,expected:clone(state.base),memo}});live();if(!sameLessonEvent(intent.ref,response.target)||response.name!==state.name||(intent.binding&&response.profile_context!=='curriculum')||response.profile?.memo!==memo)throw error('生徒メモの保存応答を確認できません。',500);
    state.base=clone(response.profile);if(state.value===raw)state.value=memo||'';state.dirty=state.value!==(state.base.memo||'');state.version++;state.status=state.dirty?'unsaved':'saved';notify();
   }
  }catch(cause){state.blocked=true;state.error=cause;state.status=cause.status===409?'conflict':'unknown';state.queue=[];notify();throw cause;}finally{state.busy=false;state.run=null;if(!state.blocked&&!['validation','acknowledgement'].includes(state.status))state.status=state.dirty?'unsaved':state.version?'saved':'ready';notify();}});return state.run;
 }
 async function reloadMemo(ref,binding){const state=profile(studentProfileName(ref,binding));if(state.busy||state.lock||state.refreshing)throw error('保存完了を待ってください。');const version=state.version;state.refreshing=true;notify();try{const response=await api('/api/student-prefs/guarded?'+studentProfileQuery(ref,binding));live();if(!sameLessonEvent(ref,response.target)||response.name!==state.name||(binding&&response.profile_context!=='curriculum'))throw error('生徒情報の対応が変更されています。');if(version!==state.version)throw error('読み込み中に生徒情報が更新されました。再確認してください。');state.dirty=false;seedProfile(ref,response,undefined,binding,true);return state;}finally{state.refreshing=false;notify();}}
 return {invalidateRecord(ref){const state=getRecord(ref);if(state&&sameLessonEvent(ref,state.ref)){state.blocked=true;state.unavailable=true;state.status='conflict';notify();}},refreshViews:notify,discardRecord(ref){const state=getRecord(ref);if(!state||state.busy)throw error('保存完了を待ってください。');state.draft=clone(state.base);state.fieldOwners={};state.dirty=false;state.error=null;state.queue=[];notify();},getRecord,seedRecord,loadRecord,editRecord,saveRecord,profile,seedProfile,loadProfile,editMemo,acknowledgeMemo,saveMemo,reloadMemo,
  lockProfile(ref,token,binding){const state=profile(studentProfileName(ref,binding));if(state.busy||state.refreshing||state.dirty||state.blocked||state.lock)return false;state.lock=token;notify();return true;},unlockProfile(ref,token,binding){const state=profile(studentProfileName(ref,binding));if(state.lock===token){state.lock=null;notify();}},
  subscribe(callback){listeners.add(callback);return ()=>listeners.delete(callback);},dispose(){disposed=true;listeners.clear();for(const state of records.values())state.queue=[];for(const state of profiles.values())state.queue=[];records.clear();profiles.clear();}};
}
