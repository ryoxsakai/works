import {installSnapshotExport} from './history-snapshot.mjs?v=1';
import {watchAuth,getSessionToken} from '../shared/auth.js?v=12';
const $=id=>document.getElementById(id),fields={lesson_plan:'授業予定',confirmation_test:'確認テスト',homework:'宿題',lesson_memo:'授業メモ'};
const pendingKey='works_lesson_history_pending_operation';
const drafts=new Map();
window.addEventListener('beforeunload',event=>{if(drafts.size||uncertain){event.preventDefault();event.returnValue='';}});
let owners=[],records=[],target=null,link=null,preview=null,busy=false,ready=false,uncertain=!!localStorage.getItem(pendingKey),view=0;
const status=message=>{$('status').textContent=message;};
const owner=()=>owners.find(item=>item.id===$('owner').value);
const formatDate=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
const element=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
async function api(path,body,method=body?'POST':'GET',signal){
 const response=await fetch('/api'+path,{method,signal,cache:'no-store',headers:{Authorization:'Bearer '+getSessionToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'読み込み・保存できませんでした'),{status:response.status,code:value.code});return value;
}
function controls(){document.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=!ready||busy||uncertain&&!el.closest('#operation-lookup')||el.dataset.conflictSave==='true');$('binding-actions').hidden=!target;}
async function action(work,{write=false}={}){
 if(busy||!ready||uncertain&&write)return;busy=true;controls();let dispatched=false;
 try{await work(()=>{dispatched=true;});status(uncertain?'未確認の保存があります。再送せず操作IDで照合してください。':write?'保存を確認しました。操作ID: '+lastOperation:'読み込みました。');}
 catch(error){status(error.message+(write?'。入力を保持しています。':''));if(dispatched&&(error instanceof TypeError||error instanceof SyntaxError||error.status>=500||error.code==='LESSON_HISTORY_RELOAD')){uncertain=true;status('保存結果が不明です。再送せず再読み込みし、記録と操作履歴を確認してください。操作ID: '+lastOperation);}}
 finally{busy=false;controls();}
}
let lastOperation=localStorage.getItem(pendingKey)||'';$('operation-id').value=lastOperation;
async function mutate(path,body,method='POST',dispatch=()=>{}){lastOperation=crypto.randomUUID();$('operation-id').value=lastOperation;localStorage.setItem(pendingKey,lastOperation);status('保存中… 操作ID: '+lastOperation);dispatch();try{const result=await api('/lesson-history'+path,{...body,request_id:lastOperation},method);localStorage.removeItem(pendingKey);status('保存済み 操作ID: '+result.operation_id);return result;}catch(error){if(error.status<500&&error.code!=='LESSON_HISTORY_RELOAD')localStorage.removeItem(pendingKey);throw error;}}
$('operation-lookup').onsubmit=event=>{event.preventDefault();action(async()=>{const id=$('operation-id').value.trim(),audit=await api('/lesson-history/audit?operation_id='+encodeURIComponent(id));$('operation-result').textContent=audit.length?'保存済み：'+audit[0].action+' / '+audit[0].created_at:'まだ保存を確認できません。再送せず、時間を置いて同じ操作IDを照合してください。';if(audit.length&&localStorage.getItem(pendingKey)===id){localStorage.removeItem(pendingKey);uncertain=false;await loadOwners();}});};
async function loadOwners(selected=$('owner').value){owners=await api('/lesson-history/owners');$('owner').replaceChildren(...owners.map(o=>{const option=element('option',o.name+' / '+(o.kind==='class'?'クラス':'生徒')+'（'+o.record_count+'件） · '+o.id.slice(0,8));option.value=o.id;return option;}));if(owners.some(o=>o.id===selected))$('owner').value=selected;await loadRecords();}
async function loadRecords(){const generation=++view,current=owner();preview=null;$('import-preview').replaceChildren();if(!current){records=[];$('records').replaceChildren();$('history-empty').textContent='生徒・クラスを登録してください。';return;}
 $('rename-owner').elements.name.value=current.name;const loaded=await api('/lesson-history/records?owner_id='+encodeURIComponent(current.id));if(generation!==view)return;records=loaded;
 $('record-choice').replaceChildren(...records.map(r=>{const option=element('option',formatDate(r.lesson_date)+' '+r.title_snapshot+' · '+r.id.slice(0,8));option.value=r.id;return option;}));
 $('history-empty').textContent=records.length?'日付順・全期間 '+records.length+'件':'授業記録はまだありません。';
 $('records').replaceChildren(...records.map(record=>{const draft=drafts.get(record.id),article=element('article'),heading=element('h3',formatDate(record.lesson_date)+' '+record.title_snapshot),form=element('form'),notice=element('p',draft?'未保存の入力を保持しています。':'');article.dataset.recordId=record.id;article.append(heading,element('p',record.event_id?'予定と紐づけ済み。予定の削除・改名でも履歴は保持します。':'予定と独立した保存済み記録'),notice);
 for(const [key,label]of Object.entries(fields)){const field=element('label',label),textarea=element('textarea');textarea.name=key;textarea.value=draft?.values[key]??record[key];textarea.rows=3;textarea.maxLength=20000;field.append(textarea);form.append(field);}
 const completed=element('label','完了 '),checkbox=element('input');checkbox.type='checkbox';checkbox.name='completed';checkbox.checked=!!(draft?.values.completed??record.completed);completed.append(checkbox);form.append(completed);const save=element('button','授業記録を保存');save.className='btn-solid history-primary';form.append(save);
 const values=()=>({...Object.fromEntries(Object.keys(fields).map(k=>[k,form.elements[k].value])),completed:checkbox.checked});
 form.oninput=()=>{drafts.set(record.id,{revision:draft?.revision??record.revision,values:values()});notice.textContent='未保存の入力を保持しています。';};
 form.onsubmit=event=>{event.preventDefault();action(async dispatch=>{try{await mutate('/records/'+record.id,{revision:drafts.get(record.id)?.revision??record.revision,...values()},'PUT',dispatch);}catch(error){if(error.status===409){try{await loadRecords();}catch{error.message+='。最新内容を取得できないため、入力を保持して読み直してください';}}throw error;}drafts.delete(record.id);await loadRecords();},{write:true});};article.append(form);
 if(draft&&draft.revision!==record.revision){
  const recovery=element('section'),title=element('h4','別の画面で更新されました。最新内容と未保存入力を比較');recovery.dataset.conflictRecord=record.id;
  recovery.append(title,element('p','入力は保持しています。下の最新内容と比較し、必要なら入力欄を編集してください。保存する内容を確認してから編集を再開できます。ここで保存や再送は行いません。'));
  for(const [key,label]of Object.entries(fields)){
   const latest=element('pre',record[key]);latest.dataset.latestField=key;
   const use=element('button','最新の'+label+'を入力へ採用');use.type='button';use.className='btn-outline history-secondary';
   use.onclick=()=>{form.elements[key].value=record[key];drafts.set(record.id,{revision:draft.revision,values:values()});notice.textContent='未保存の入力を保持しています。比較後に編集の再開を確認してください。';};
   recovery.append(element('h5','最新の'+label),latest,use);
  }
  recovery.append(element('p','最新の完了状態：'+(record.completed?'完了':'未完了')));
  const useCompleted=element('button','最新の完了状態を入力へ採用');useCompleted.type='button';useCompleted.className='btn-outline history-secondary';useCompleted.onclick=()=>{checkbox.checked=!!record.completed;drafts.set(record.id,{revision:draft.revision,values:values()});};recovery.append(useCompleted);
  const confirmation=element('label','最新内容と入力を比較し、保存する内容を確認しました。'),ack=element('input');ack.type='checkbox';confirmation.prepend(ack);recovery.append(confirmation);
  const resume=element('button','比較した入力で編集を再開する');resume.type='button';resume.className='btn-solid history-primary';resume.onclick=()=>action(async()=>{if(!ack.checked)throw Error('最新内容との比較を確認してください');drafts.set(record.id,{revision:record.revision,values:values()});await loadRecords();});
  const discard=element('button','未保存入力を破棄して最新内容を使う');discard.type='button';discard.className='btn-outline history-secondary';discard.onclick=()=>action(async()=>{drafts.delete(record.id);await loadRecords();});
  recovery.append(resume,discard);article.append(recovery);save.disabled=true;save.dataset.conflictSave='true';
 }
 if(record.event_id){const detach=element('button','この記録の予定との紐づけを外す');detach.className='btn-outline history-secondary';detach.onclick=()=>action(async dispatch=>{await mutate('/binding',{target:JSON.parse(record.target_json),link_revision:record.link_revision,decision:'detach'},'POST',dispatch);await loadRecords();},{write:true});article.append(detach);}
 return article;}));controls();
}
$('owner').onchange=()=>action(loadRecords);
$('create-owner').onsubmit=event=>{event.preventDefault();action(async dispatch=>{const form=event.target,result=await mutate('/owners',{name:form.elements.name.value,kind:form.elements.kind.value},'POST',dispatch);form.reset();await loadOwners(result.owner.id);},{write:true});};
$('rename-owner').onsubmit=event=>{event.preventDefault();action(async dispatch=>{const current=owner();if(!current)throw Error('生徒・クラスを選択してください');await mutate('/owners/'+current.id,{name:event.target.elements.name.value,revision:current.revision},'PUT',dispatch);await loadOwners(current.id);},{write:true});};
$('new-record').onsubmit=event=>{event.preventDefault();action(async dispatch=>{const current=owner();if(!current)throw Error('生徒・クラスを選択してください');await mutate('/records',{owner_id:current.id,owner_revision:current.revision,lesson_date:new Date(event.target.elements.date.value).toISOString()},'POST',dispatch);await loadOwners(current.id);},{write:true});};
async function loadPendingPlans(onlyTarget=false){
 const query=onlyTarget&&target?'?'+new URLSearchParams({calendar_id:target.calendar_id,event_id:target.id}):'';
 const list=await api('/lesson-history/pending-plans'+query),box=$('pending-plan-list');box.replaceChildren();
 if(list.length===200)box.append(element('p','最新200件を表示しています。対象の予定を指定して絞り込めます。'));
 if(!list.length){box.append(element('p','保存済みの未紐づけ下書きはありません。'));return;}
 for(const draft of list){
  const observed=JSON.parse(draft.target_json),article=element('article');article.append(element('h3',observed.title+' / '+formatDate(observed.start)),element('p','予定単位の下書き · revision '+draft.revision),element('pre',draft.lesson_plan));
  const download=element('button','この下書きをファイルへ保存');download.type='button';download.className='btn-outline history-secondary';download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='works-pending-plan-'+draft.id.slice(0,12)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};article.append(download);
  const current=owner(),record=records.find(r=>r.id===link?.record_id);
  if(target&&link?.record_id&&record&&record.owner_id===current?.id&&observed.calendar_id===target.calendar_id&&observed.id===target.id){
   article.append(element('p','採用先：'+current.name+' / '+formatDate(record.lesson_date)),element('h4','現在の保存済み授業予定'),element('pre',record.lesson_plan));
   const ack=element('input');ack.type='checkbox';const label=element('label','下書きと現在の内容を比較し、選択中の生徒・クラスへの採用を確認しました。');label.prepend(ack);article.append(label);
   const adopt=element('button','この下書きを授業予定の入力へ採用');adopt.type='button';adopt.className='btn-outline history-secondary';adopt.onclick=()=>action(async()=>{
    if(!ack.checked||owner()?.id!==current.id||link?.record_id!==record.id)throw Error('採用先と下書きの比較を確認してください');
    const oldDraft=drafts.get(record.id);if(oldDraft&&(oldDraft.revision!==record.revision||Object.keys(fields).some(k=>oldDraft.values[k]!==record[k])||!!oldDraft.values.completed!==!!record.completed))throw Error('採用先に未保存入力があります。入力を失わないよう、先に比較・保存してください');
    const article=$('records').querySelector('[data-record-id="'+record.id+'"]'),form=article?.querySelector('form');if(!form)throw Error('採用先の記録を再読込してください');form.elements.lesson_plan.value=draft.lesson_plan;
    drafts.set(record.id,{revision:record.revision,values:{...Object.fromEntries(Object.keys(fields).map(k=>[k,form.elements[k].value])),completed:form.elements.completed.checked}});await loadRecords();$('records').querySelector('[data-record-id="'+record.id+'"]').scrollIntoView({block:'start'});status('下書きを入力へ採用しました。まだ保存していません。内容を確認して授業記録を保存してください。');
   });article.append(adopt);
  }else article.append(element('p','この予定を正式に紐づけ、該当する生徒・記録を選択してから採用してください。古い予定の内容は自動で引き継ぎません。'));
  box.append(article);
 }
}
$('pending-plans').onclick=()=>action(()=>loadPendingPlans());
async function lookup(){const result=await api('/lesson-history/target',{target:{calendar_id:$('calendar').value,id:$('event-id').value.trim()}});target=result.target;link=result.link;preview=null;$('import-preview').replaceChildren();$('target-details').replaceChildren(element('p',target.title+' / '+target.start),element('p',link?.record_id?'現在の記録ID: '+link.record_id:'まだ紐づけられていません。旧記録がある場合は先にプレビューしてください。'));try{await loadPendingPlans(true);}catch{$('pending-plan-list').textContent='下書きを取得できませんでした。入力の原文は保持し、再取得してください。';}}
$('lookup').onsubmit=event=>{event.preventDefault();action(lookup);};
for(const [id,decision]of [['same-owner','same_owner'],['different-owner','different_owner'],['new-binding','new'],['attach','attach'],['detach','detach']])$(id).onclick=()=>action(async dispatch=>{
 const current=owner();if(!current||!target)throw Error('生徒・クラスと予定を選択してください');const chosen=records.find(r=>r.id===$('record-choice').value);
 await mutate('/binding',{target,link_revision:link?.revision||0,decision,owner_id:current.id,owner_revision:current.revision,record_id:decision==='same_owner'?link?.record_id:chosen?.id,record_revision:chosen?.revision},'POST',dispatch);await lookup();await loadOwners(current.id);
},{write:true});
$('preview').onclick=()=>action(async()=>{
 if(!target||!owner())throw Error('生徒・クラスと予定を選択してください');preview=await api('/lesson-history/import/preview',{target});const current=owner(),box=$('import-preview');box.replaceChildren(element('h3','移行前の比較'),element('p','取り込み先: '+current.name+' · '+current.id),element('p','採用元: '+(preview.origin==='calendar_latest'?'カレンダーの最新値':'旧D1原記録')),element('p','旧DBの帰属確認時の名前: '+(preview.identity?.title||'不明（現在の予定名だけでは判定しません）')));
 for(const [key,label]of Object.entries(fields)){box.append(element('h4',label),element('pre','採用する内容：\n'+preview.values[key]),element('pre','旧DB：\n'+(preview.source?.[key]??'')));}
 const confirm=element('label','この個別予定の記録が、選択した生徒・クラスに属することを確認しました。'),checkbox=element('input');checkbox.type='checkbox';confirm.prepend(checkbox);const button=element('button','確認した最新内容をD1へ取り込む');button.className='btn-solid history-primary';box.append(confirm,button);
 const chosenOwner={...current},shown=preview;if(shown.imported_record)button.textContent='編集されていないD1取り込み記録を最新値へ更新';button.onclick=()=>action(async dispatch=>{if(!checkbox.checked||owner()?.id!==chosenOwner.id)throw Error('所属の確認が必要です');await mutate('/import',{owner_id:chosenOwner.id,owner_revision:chosenOwner.revision,confirm_owner:true,preview:shown,refresh:!!shown.imported_record,record_revision:shown.imported_record?.revision},'POST',dispatch);await lookup();await loadOwners(chosenOwner.id);},{write:true});
});
$('legacy').onclick=()=>action(async()=>{const legacy=await api('/lesson-history/legacy');$('legacy-list').replaceChildren(...legacy.map(row=>{const p=element('p',(row.title||'所属不明')+' · '+row.calendar_event_id+(row.hold_reason?' / 保留':'')),button=element('button','現在の予定を探して確認');button.className='btn-outline history-secondary';button.onclick=()=>action(async()=>{const found=await api('/lesson-history/locate',{event_id:row.calendar_event_id});if(!found.length){p.append(element('span','現在の予定が見つかりません。原記録は保持しています。所属・授業日を別途確認してください。'));return;}for(const ref of found){const choose=element('button',ref.title+' / '+ref.start+' / '+ref.calendar_id);choose.className='btn-outline history-secondary';choose.onclick=()=>action(async()=>{$('calendar').value=ref.calendar_id;$('event-id').value=ref.id;await lookup();$('lookup').scrollIntoView({block:'start'});});p.append(choose);}});p.append(button);return p;}));});
watchAuth({onSignedOut(){ready=false;controls();status('本人の既存ログインが必要です。授業管理からログインしてください。');},async onSignedIn(){ready=true;controls();await action(async()=>{const state=await api('/lesson-history/status');if(state.mode==='off'){ready=false;throw Error('新しい授業履歴はまだ本番切替前です。');}const settings=await api('/settings');$('calendar').replaceChildren(...(settings.selected_calendars||[]).map(id=>{const option=element('option',id);option.value=id;return option;}));await loadOwners();const params=new URLSearchParams(location.search);if(params.has('operation_id'))$('operation-id').value=params.get('operation_id');if(params.has('event_id')){$('calendar').value=params.get('calendar_id');$('event-id').value=params.get('event_id');await lookup();}});}});

installSnapshotExport({api,action,status});
