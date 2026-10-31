import {readNextLessonWithTemplate} from "../shared/next-lesson-read.mjs?v=1";
import { curriculumSelectionName } from "../shared/student-profile-key.js";
import {lessonRecordRows,renderPlanEditors,renderMemoEditors} from '../shared/lesson-record-view.mjs';
import {lessonEventKey,isScheduledLesson} from '../shared/lesson-plan.js';
import {lessonRecordNeedsReview} from '../shared/lesson-attribution.js';
import {createLessonPlanController} from '../tutor/lesson-plan.js?v=4';
import {createStudentMemoStore} from '../tutor/student-memo.js?v=1';
import {attachRecordCarousel} from '../tutor/record-carousel.mjs?v=2';
import {attachRecordToasts} from '../tutor/record-toasts.mjs?v=2';
import {decorateTutor} from '../shared/ui/tutor-presentation.mjs';
import {esc} from './model.mjs';
import {lessonApi} from './lesson-model.mjs';

const feedback=()=>'<div class="lesson-plan-feedback"><small class="lesson-plan-status" role="status" aria-live="polite"></small><button type="button" class="lesson-plan-action" hidden></button></div>';
export function createHomeLessonCards(model,{session,getSessionToken,onExpired,reload,onNotice=()=>{},onStateChange=()=>{},readAt=Date.now()}) {
 const element=document.createElement('div');element.className='home-lesson-cards tutor-bootstrap record-panel';
 element.innerHTML=`<p class="home-lesson-day">授業日 ${esc(model.day)}</p><p class="home-lesson-error" role="alert"></p><button type="button" class="home-lesson-reset btn btn-outline" hidden>全カードの入力を破棄して最新情報を取得</button><div class="table-scroll"><table id="record-table" class="curriculum-table"><tbody></tbody></table></div>`;
 const root=element.querySelector('tbody'),error=element.querySelector('.home-lesson-error'),readAbort=new AbortController(),events=new AbortController();
 let active=true,editing=false,paused=false,pausedScroll=0,restorePending=false,pausedFocus=null,pausedSelection=null;
 const memoReadSources=new Map(),profileProofs=new Map(),memoSources=new Map(),memoConflicts=new Set(),memoBases=new Map();
 const unknownPlans=new Set(),unknownMemos=new Set(),memoQueues=new Map(),pendingMemos=new Map(),composing=new WeakSet(),deferred=new WeakSet();
 const valid=()=>active&&getSessionToken()===session;
 const api=lessonApi({session,isCurrent:valid,signal:readAbort.signal,onUnauthorized:()=>{if(active)onExpired();}});
 const call=async(path,opts)=>{try{return await api(path,opts);}catch(e){if(e.status===401&&active)onExpired();throw e;}};
 const eligible=r=>isScheduledLesson(r.ref,model.settings?.excluded_titles||[]);
 // No guessed annotation removal or cross-calendar identity merging.
 const nameFor=title=>model.rows.some(r=>r.label===title&&eligible(r))?curriculumSelectionName(title):'';
 const names=[...new Set(model.rows.filter(r=>!lessonRecordNeedsReview(r.record)).map(r=>nameFor(r.label)).filter(Boolean))];
 const resize=input=>{if(!input.getClientRects().length)return;input.style.height='auto';const s=getComputedStyle(input);input.style.height=`${input.scrollHeight+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth)}px`;};
 const date=ref=>{if(!ref)return '';const start=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(ref.start));const end=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(ref.end));return `${start}–${end}`;};
 const formatTime=iso=>{if(/^\d{4}-\d{2}-\d{2}$/.test(iso))return '終日';const time=new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'});const period=[...model.periods].sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))).filter(p=>p.start_time<=time).at(-1);return esc(period?.label||time);};
 const plans=createLessonPlanController({readNext:async source=>{const v=await readNextLessonWithTemplate(source,call,applyTarget,session,getSessionToken);if(!v?.source||v.source.id!==source.id||v.source.calendar_id!==source.calendar_id||v.target&&(!isScheduledLesson(v.target,model.settings?.excluded_titles||[])||v.target.calendar_id!==source.calendar_id||v.target.id===source.id||!Number.isSafeInteger(v.record_revision)||v.record_revision<0))throw new Error('次回予定の応答を確認できません');return v;},write:async body=>{
  const key=lessonEventKey(body.target);if(unknownPlans.has(key))throw new Error('保存結果が未確認です。再送は停止しています。');
  try{const result=await call('/lesson-plan',{method:'PUT',body:JSON.stringify(body)});if(result.target)applyTarget(body.target,result.target,result.record_revision);return result;}catch(e){if(e.unknown)unknownPlans.add(key);throw e;}
 },onChange:render});
 const memos=createStudentMemoStore({readProfile:async name=>{
  const row=memoReadSources.get(name)||model.rows.find(r=>nameFor(r.label)===name&&!lessonRecordNeedsReview(r.record));
  if(!row)throw new Error('生徒情報の対象を確認してください');
  const value=await call(`/student-prefs/guarded?calendar_id=${encodeURIComponent(row.ref.calendar_id)}&event_id=${encodeURIComponent(row.ref.id)}&profile_context=curriculum&name=${encodeURIComponent(name)}`);
  if(value?.name!==name||!value.profile||!value.target)throw new Error('生徒情報の対象を確認できません');
  profileProofs.set(name,value);memoBases.set(name,value.profile.memo||'');return {...value.profile,name};
 },writeMemo:(name,memo)=>{
  const source=memoSources.get(name);
  if(!source)return Promise.reject(new Error('共有先の名前キーを確認してください'));
  const fixed=structuredClone(source),previous=memoQueues.get(name)||Promise.resolve();pendingMemos.set(name,(pendingMemos.get(name)||0)+1);queueMicrotask(render);
  const save=previous.catch(()=>{}).then(async()=>{
   if(unknownMemos.has(name)||memoConflicts.has(name))throw new Error('保存結果・競合の確認が必要です。再送は停止しています。');
   const proof=profileProofs.get(name);if(!proof)throw new Error('生徒情報を取得してから編集してください');
   const revision=plans.get(lessonEventKey(fixed))?.recordRevision;
   try{const value=await call('/student-prefs/guarded',{method:'PUT',body:JSON.stringify({target:fixed,name,profile_context:'curriculum',shared_name_acknowledged:true,record_revision:revision,expected:proof.profile,memo})});profileProofs.set(name,value);memoBases.set(name,value.profile.memo||'');return value;}
   catch(e){if(e.unknown)unknownMemos.add(name);if(e.status===409)memoConflicts.add(name);throw e;}
  });
  memoQueues.set(name,save);return save.finally(()=>{pendingMemos.set(name,pendingMemos.get(name)-1);if(memoQueues.get(name)===save)memoQueues.delete(name);render();});
 },onChange:render});
 function applyTarget(before,after,revision){
  plans.observeTarget(before,after);if(Number.isSafeInteger(revision))plans.observeRecord(after,revision);for(const row of root.querySelectorAll('tr[data-record-ref]')){const ref=JSON.parse(row.dataset.recordRef);if(lessonEventKey(ref)===lessonEventKey(before)){row.dataset.recordRef=JSON.stringify(after);if(Number.isSafeInteger(revision))row.dataset.recordRevision=revision;}}
  for(const item of model.rows)if(lessonEventKey(item.ref)===lessonEventKey(before))item.ref=after;
 }
 function render(){if(!active)return;
  const problem=states().some(s=>['error','conflict'].includes(s.status))||names.some(n=>memos.get(n).status.endsWith('error'))||unknownMemos.size||unknownPlans.size;
  error.textContent=problem?'取得・保存・対応状態の確認が必要です。入力は保持しています。未確認の保存は再送しません。':'';element.querySelector('.home-lesson-reset').hidden=!problem;
  renderPlanEditors(root,plans,{lessonPlanDate:date,resizeRecordInput:resize});renderMemoEditors(root,memos,{resizeRecordInput:resize});
  for(const editor of root.querySelectorAll('.lesson-plan-editor'))if(unknownPlans.has(editor.dataset.planKey)){
   editor.querySelector('textarea').readOnly=true;const status=editor.querySelector('.lesson-plan-status');status.textContent='保存結果を確認できません。入力を保持し、再送を停止しています。授業管理で確認してください。';status.dataset.error='true';status.classList.remove('record-transient-status');editor.querySelector('.lesson-plan-action').disabled=true;
  }
  for(const editor of root.querySelectorAll('.student-memo-editor')){
   if(!editor.dataset.studentName){editor.querySelector('.student-memo-status').textContent='生徒名・所属の確認は授業管理から行ってください。';}
   const ack=editor.querySelector('.home-memo-ack');if(ack)ack.disabled=!editor.dataset.studentName||unknownMemos.has(editor.dataset.studentName)||memoConflicts.has(editor.dataset.studentName)||(pendingMemos.get(editor.dataset.studentName)>0)||(memos.get(editor.dataset.studentName).dirty&&memos.get(editor.dataset.studentName).value.trim()!==memoBases.get(editor.dataset.studentName));const acknowledged=ack?.checked;editor.querySelector('textarea').readOnly=!acknowledged;if(!acknowledged){editor.querySelector('textarea').value='';editor.querySelector('textarea').placeholder='共有先を確認すると表示・編集できます';resize(editor.querySelector('textarea'));if(!memos.get(editor.dataset.studentName).status.endsWith('error'))editor.querySelector('.student-memo-status').textContent='名前キーの確認後に取得します';}
   if(unknownMemos.has(editor.dataset.studentName)||memoConflicts.has(editor.dataset.studentName)){editor.querySelector('textarea').readOnly=true;const status=editor.querySelector('.student-memo-status');status.textContent='保存結果を確認できません。入力を保持し、再送を停止しています。授業管理で確認してください。';status.dataset.error='true';status.classList.remove('record-transient-status');editor.querySelector('button').hidden=true;}
  }
  for(const row of root.querySelectorAll('tr[data-event-id]')){
   const data=model.rows.find(r=>r.eventId===row.dataset.eventId&&r.calendarId===JSON.parse(row.dataset.recordRef).calendar_id);
   if(data&&!eligible(data))for(const control of row.querySelectorAll('textarea,button:not(.record-student-link)'))control.disabled=true;
  }

  onStateChange();
 }
 for(const row of model.rows)if(!lessonRecordNeedsReview(row.record))plans.seed(row.ref,row.lessonPlan,plans.version,row.record.record_revision,row.record.attribution_status);
 root.innerHTML=lessonRecordRows(model.rows,{
  escapeHtml:esc,formatTimeOrPeriod:formatTime,lessonRecordNeedsReview,
  lessonReviewRow:(_ref,_record,label,time)=>_record.record_pending_operation?`<tr><td colspan="7"><strong>${esc(label)}</strong> ${time}<p role="status">保存結果を確認するまで再送を停止しています。</p><button type="button" class="calendar-record-reconcile" data-ref="${esc(JSON.stringify(_ref))}">保存結果を照合する</button></td></tr>`:`<tr><td colspan="7"><strong>${esc(label)}</strong> ${time}<p role="status">予定名・所属の対応確認が必要です。確認まで内容の表示と編集を停止しています。</p><a class="lesson-record-review" href="/tutor/">授業管理で確認する</a></td></tr>`,
  lightenHexColor:color=>/^#[0-9a-f]{6}$/i.test(color)?'#'+[1,3,5].map(i=>Math.round(parseInt(color.slice(i,i+2),16)*.25+255*.75).toString(16).padStart(2,'0')).join(''):'#e7e9ec',calendarName:id=>model.calendars.find(c=>c.id===id)?.summary||'カレンダー',lessonAttributionNotice:()=>'',
  lessonPlanEditor:(ref,title,className)=>`<div class="lesson-plan-editor" data-plan-key="${esc(lessonEventKey(ref))}"><textarea class="${className} linked-lesson-plan" rows="1" maxlength="5000" aria-label="${esc(title)}の授業予定"></textarea>${feedback()}</div>`,lessonPlanFeedback:feedback,recordStudentPrefName:nameFor,lessonEventKey
 });
 for(const editor of root.querySelectorAll('.student-memo-editor')){
  const label=document.createElement('label');label.className='home-memo-confirm';const source=JSON.parse(editor.closest('tr').dataset.recordRef);
  label.innerHTML=`<input type="checkbox" class="home-memo-ack"> 予定「${esc(source.title)}」（${esc(model.calendars.find(c=>c.id===source.calendar_id)?.summary||"カレンダー")} ${formatTime(source.start)}）→ 生徒情報「${esc(editor.dataset.studentName)}」の共有先を確認して編集する`;
  editor.prepend(label);
 }
 function saveInput(input){if(!valid()||paused||editing||input.disabled||input.readOnly)return;
  if(composing.has(input)){deferred.add(input);return;}
  if(input.matches('.linked-lesson-plan')){const editor=input.closest('.lesson-plan-editor');if(input.value!==plans.get(editor.dataset.planKey)?.value)plans.edit(editor.dataset.planKey,input.value);if(input.value===plans.get(editor.dataset.planKey)?.base&&!plans.get(editor.dataset.planKey)?.pending){plans.discard(editor.dataset.planKey);return;}plans.save(editor.dataset.planKey,editor.dataset.sourceKey).catch(()=>{});}
  if(input.matches('.student-memo-input')){const name=input.closest('.student-memo-editor').dataset.studentName;if(name&&input.closest('.student-memo-editor').querySelector('.home-memo-ack')?.checked){memoSources.set(name,JSON.parse(input.closest('tr').dataset.recordRef));if(input.value.trim()===memoBases.get(name)&&!(pendingMemos.get(name)>0))return;memos.edit(name,input.value);memos.save(name).catch(()=>{});}}
 }
 root.addEventListener('compositionstart',e=>composing.add(e.target),{signal:events.signal});
 root.addEventListener('compositionend',e=>{composing.delete(e.target);if(deferred.has(e.target)){deferred.delete(e.target);saveInput(e.target);}},{signal:events.signal});
 root.addEventListener('input',e=>{const input=e.target;if(!valid()||paused||editing||input.disabled||input.readOnly)return;if(input.matches('.linked-lesson-plan')){const key=input.closest('.lesson-plan-editor').dataset.planKey,state=plans.get(key);if(input.value===state?.base&&!state?.pending)plans.discard(key);else plans.edit(key,input.value);}if(input.matches('.student-memo-input')){const name=input.closest('.student-memo-editor').dataset.studentName;if(name)memos.edit(name,input.value);}if(input.matches('textarea'))resize(input);},{signal:events.signal});
 root.addEventListener('change',e=>{if(e.target.matches('.home-memo-ack')){const editor=e.target.closest('.student-memo-editor'),name=editor.dataset.studentName;if(e.target.checked&&name&&!memos.get(name).loaded){memoReadSources.set(name,model.rows.find(r=>r.eventId===editor.closest('tr').dataset.eventId&&r.calendarId===JSON.parse(editor.closest('tr').dataset.recordRef).calendar_id));memos.load(name).catch(()=>{});}render();}else saveInput(e.target);},{signal:events.signal});
 root.addEventListener('click',async e=>{
  if(!valid()||paused||editing)return;
  const reconcile=e.target.closest('.calendar-record-reconcile');if(reconcile&&!reconcile.disabled){reconcile.disabled=true;try{await call('/calendar-lesson-record/reconcile',{method:'POST',body:JSON.stringify({target:JSON.parse(reconcile.dataset.ref)})});element.dispatchEvent(new CustomEvent('home-lesson-discard-reload',{bubbles:true}));}catch(error){onNotice(error.message);reconcile.disabled=false;}return;}
  if(e.target.closest('.record-student-link')){element.dispatchEvent(new CustomEvent('home-lesson-navigate',{bubbles:true}));return;}
  let button=e.target.closest('.record-recheck');if(button&&!button.disabled){button.closest('tr').querySelector('.record-next-plan .lesson-plan-action').click();return;}
  button=e.target.closest('.student-memo-retry');if(button&&!button.disabled){const name=button.closest('.student-memo-editor').dataset.studentName;if(unknownMemos.has(name))return;const s=memos.get(name);(s.status==='load-error'?memos.load(name,{refresh:true}):memos.save(name)).catch(()=>{});return;}
  button=e.target.closest('.lesson-plan-action');if(!button||button.disabled)return;
  const editor=button.closest('.lesson-plan-editor'),key=editor.dataset.planKey,source=editor.dataset.sourceKey;
  if(unknownPlans.has(key))return;
  if(button.dataset.action==='recheck'){const link=plans.getLink(source);if(link)await plans.loadNext(link.source);return;}
  if(button.dataset.action==='retry'){plans.save(key,source).catch(()=>{});return;}
  if(plans.get(key)?.dirty&&!confirm('この授業の未保存入力を破棄して予定を再確認しますか？'))return;
  plans.discard(key);reload();
 },{signal:events.signal});
 element.querySelector('.home-lesson-reset').addEventListener('click',()=>{
  if(pending()){onNotice('保存中です。結果を確認してから再取得してください。');return;}
  if(hasEdits()&&!confirm('全カードの未保存・未確認の入力を破棄して最新情報を取得しますか？ 未確認の保存は再送しません。'))return;
  element.dispatchEvent(new CustomEvent('home-lesson-discard-reload',{bubbles:true}));
 },{signal:events.signal});
 const observer=new ResizeObserver(()=>root.querySelectorAll('textarea').forEach(resize));observer.observe(root);
 const toast=attachRecordToasts(root),carousel=attachRecordCarousel(root);decorateTutor(element);render();
 for(const row of model.rows)if(!lessonRecordNeedsReview(row.record))plans.loadNext(row.ref);

 function states(){return [...new Set(model.rows.flatMap(r=>[lessonEventKey(r.ref),plans.getLink(lessonEventKey(r.ref))?.targetKey]).filter(Boolean))].map(k=>plans.get(k)).filter(Boolean);}
 function pending(){return states().some(s=>s.pending)||[...pendingMemos.values()].some(n=>n>0);}
 function hasEdits(){return pending()||states().some(s=>s.dirty)||names.some(n=>memos.get(n).dirty&&memos.get(n).value.trim()!==memoBases.get(n))||unknownPlans.size>0||unknownMemos.size>0;}
 return {element,session,day:model.day,readAt,hasEdits,pending,
  setEditing(value){editing=value;element.inert=value;render();},
  refreshLayout(){if(active){decorateTutor(element);render();}},
  pause(){paused=true;pausedScroll=root.scrollLeft;pausedFocus=element.contains(document.activeElement)?document.activeElement:null;pausedSelection=pausedFocus?.matches("textarea")?[pausedFocus.selectionStart,pausedFocus.selectionEnd]:null;},resume(){paused=false;restorePending=true;render();},scrollPosition(){return restorePending?pausedScroll:root.scrollLeft;},restoreScroll(value){root.scrollLeft=value;restorePending=false;if(pausedFocus?.isConnected&&!editing){pausedFocus.focus({preventScroll:true});if(pausedSelection)pausedFocus.setSelectionRange(...pausedSelection);}pausedFocus=null;pausedSelection=null;},
  canLeave(){if(!hasEdits())return true;if(pending()){onNotice('授業記録を保存中です。結果を確認してから移動してください。');return false;}return confirm('授業記録の未保存・未確認の入力を破棄して移動しますか？');},
  destroy(){active=false;events.abort();readAbort.abort();observer.disconnect();carousel.destroy();toast.destroy();element.remove();}
 };
}
