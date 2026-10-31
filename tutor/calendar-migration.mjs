import {watchAuth,getSessionToken} from '../shared/auth.js?v=12';
import {sameLessonEvent,lessonEventRef} from '../shared/lesson-plan.js';
import {parseCalendarRecord} from '../shared/calendar-lesson-record.mjs';
const $=id=>document.getElementById(id),records=[];let authenticated=false,busy=false,downloaded=false,scanned=false,baselineReady=false;
const status=text=>{$('status').textContent=text;};
async function api(path,body,method=body?'POST':'GET'){
 const token=getSessionToken();if(!authenticated||!token)throw Error('既存の本人ログインが必要です');
 const response=await fetch('/api'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok){const error=Error(value.error||'取得・保存できません ('+response.status+')');error.code=value.code;throw error;}return value;
}
const call=(path,body)=>api('/calendar-lesson-migration/'+path,body);
const confirmable=r=>r.state==='held'&&['attribution_legacy_unverified','attribution_legacy_historical','attribution_title_changed'].includes(r.reason)&&r.preview&&!(r.preview.event_before.description||'').trim()&&!r.confirmationSent;
const replaceable=r=>{if(r.state!=='held'||!['attribution_legacy_unverified','attribution_legacy_historical','attribution_title_changed','existing_description'].includes(r.reason)||!r.preview||r.confirmationSent||!(r.preview.event_before.description||'').trim())return false;try{return !parseCalendarRecord(r.preview.event_before.description);}catch{return false;}};
async function refresh(r){r.preview=await call('preview',{event_id:r.event_id,...(r.replaceRequested?{replace_unmanaged_description:true,expected_description:r.replacement_before_description}:{})});r.state=r.preview.plan.status;r.reason=r.preview.plan.reason;if(r.state==='ready'&&(r.preview.event_before.description||'').trim()&&r.preview.plan.mode!=='replace_unmanaged_description'){r.state='held';r.reason='existing_description';}}
function render(){
 $('scan').disabled=!authenticated||busy||records.some(r=>r.dispatched||r.confirmationSent);$('download').disabled=!scanned||busy;
 $('backup').disabled=!downloaded||busy;
 const counts={};for(const r of records)counts[r.state]=(counts[r.state]||0)+1;
 $('summary').textContent=Object.entries(counts).map(([k,n])=>k+': '+n+'件').join(' / ');
 $('items').replaceChildren(...records.map(r=>{const li=document.createElement('li'),text=document.createElement('span');text.textContent=(r.preview?.event_before?.summary||r.event_id)+' '+(r.preview?.event_before?.start?.dateTime||r.preview?.event_before?.start?.date||'')+' — '+r.state+(r.reason?' ('+r.reason+')':'');li.append(text);
  if(confirmable(r)){const button=document.createElement('button');button.textContent='この予定への帰属を確認する';button.disabled=busy||!baselineReady;button.addEventListener('click',()=>reviewAttribution(r));li.append(button);}
  if(replaceable(r)){const button=document.createElement('button');button.textContent='この1件の既存説明の置換を確認する';button.disabled=busy||!baselineReady;button.addEventListener('click',()=>reviewAttribution(r,true));li.append(button);}
  if(r.state==='ready'){const button=document.createElement('button');button.textContent=r.preview.plan.mode==='replace_unmanaged_description'?'この1件の既存説明を置換する':'この1件を転記する';button.disabled=busy||!downloaded||!$('backup').checked||r.dispatched;button.addEventListener('click',()=>apply(r));li.append(button);}return li;}));
}
$('scan').addEventListener('click',async()=>{
 if(busy)return;busy=true;scanned=false;downloaded=false;baselineReady=false;$('backup').checked=false;records.length=0;render();status('予定とDBの対応を確認しています。書き込みは行いません。');
 try{let cursor='',done=false;const seen=new Set();while(!done){const page=await call('records?cursor='+encodeURIComponent(cursor));if(!Array.isArray(page.items))throw Error('対象一覧の形式を確認できません');for(const item of page.items){if(typeof item.calendar_event_id!=='string'||seen.has(item.calendar_event_id))throw Error('対象一覧の重複を確認してください');seen.add(item.calendar_event_id);records.push({event_id:item.calendar_event_id,state:'pending'});}done=page.done===true;if(!done&&(!page.next_cursor||page.next_cursor===cursor))throw Error('一覧の続きが確認できません');cursor=page.next_cursor;}
  for(const r of records){try{await refresh(r);}catch(e){r.state='held';r.reason=e.message;}render();}
  scanned=true;status('確認が完了しました。確認データを非公開で保存してから、転記可能な予定を1件ずつ処理してください。');
 }catch(e){status(e.message);}finally{busy=false;render();}
});
$('download').addEventListener('click',()=>{
 if(!scanned||busy)return;const blob=new Blob([JSON.stringify({format:1,cutoff:'2026-10-20T00:00:00+09:00',captured_at:new Date().toISOString(),records},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='works-calendar-private-snapshot.json';a.click();URL.revokeObjectURL(url);downloaded=true;render();
});
$('backup').addEventListener('change',()=>{if(downloaded)baselineReady=$('backup').checked;render();});

async function reviewAttribution(r,replace=false){
 if(busy||!baselineReady||!(replace?replaceable(r):confirmable(r)))return;
 busy=true;render();status('この予定と旧記録を再取得しています。');let dialog;
 try{
  const review=await api('/lesson-record?calendar_id='+encodeURIComponent(r.preview.calendar_id)+'&event_id='+encodeURIComponent(r.event_id));
  const expected=r.preview.event_before,target=review.target,old=review.original_db_record||review.previous_record;
  if(!target||target.id!==r.event_id||target.calendar_id!==r.preview.calendar_id||!old?.record_exists||!Number.isSafeInteger(old.record_revision)||review.record?.record_pending_operation||
    !sameLessonEvent(target,lessonEventRef(expected,r.preview.calendar_id)))throw Error('予定または記録が変わりました。帰属は変更していません。');
  if(replace&&(review.record?.record_calendar_managed||review.record?.record_pending_operation||parseCalendarRecord(expected.description||'')))throw Error('管理済みの説明は授業画面で確認してください');
  dialog=document.createElement('dialog');dialog.setAttribute('aria-label','個別の授業記録の帰属確認');
  const heading=document.createElement('h2');heading.textContent=replace?'この1件の既存説明の置換を確認する':'この予定へ旧記録を引き継ぐ';dialog.append(heading);
  const details=document.createElement('pre');details.textContent=target.title+'\n'+target.start+'\n旧記録の名前：'+(old.record_title||old.record_observed_title||'未確認')+'\n\n'+Object.entries({lesson_plan:'授業予定：',confirmation_test:'確認テスト：',homework:'宿題：',lesson_memo:'授業メモ：'}).map(([k,label])=>label+(old[k]||'')).join('\n');dialog.append(details);
  if(replace){const before=document.createElement('pre');before.textContent='置換前のカレンダー説明：\n'+expected.description;dialog.append(before);}
  const note=document.createElement('p');note.textContent='この1件の旧記録を履歴に保存して、予定への帰属を確定します。DB原文・生徒メモ・カレンダーの説明は変更しません。';if(replace)note.textContent+=' 既存説明は転記履歴に保存してから4欄へ置き換えます。ここではまだ説明を変更せず、更新したバックアップの確認後に別操作で実行します。';dialog.append(note);
  const label=document.createElement('label'),ack=document.createElement('input');ack.type='checkbox';label.append(ack,document.createTextNode('上記はこの予定の授業記録と本人確認済みです。'));dialog.append(label);
  let replaceAck;if(replace){const label=document.createElement('label');replaceAck=document.createElement('input');replaceAck.type='checkbox';label.append(replaceAck,document.createTextNode('表示された既存説明を、上記4欄へ置き換えることを確認しました。'));dialog.append(label);}
  const accept=document.createElement('button'),cancel=document.createElement('button');accept.textContent='この1件の帰属を確定する';accept.disabled=true;cancel.textContent='変更せず閉じる';dialog.append(accept,cancel);
  let sending=false;const updateAccept=()=>accept.disabled=!ack.checked||!!replaceAck&&!replaceAck.checked||sending;ack.addEventListener('change',updateAccept);replaceAck?.addEventListener('change',updateAccept);cancel.addEventListener('click',()=>dialog.close());dialog.addEventListener('cancel',e=>{if(sending)e.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();busy=false;render();});
  accept.addEventListener('click',async()=>{
   if(sending||!ack.checked||replaceAck&&!replaceAck.checked)return;sending=true;r.confirmationSent=true;r.confirmation_before=review;accept.disabled=true;cancel.disabled=true;ack.disabled=true;if(replaceAck)replaceAck.disabled=true;
   try{if(review.record?.attribution_status!=='confirmed')r.confirmation_result=await api('/lesson-record',{target,record_revision:old.record_revision,decision:'inherit',...(replace?{unmanaged_only:true}:{})},'PUT');else r.confirmation_result={attribution_status:'already_confirmed'};if(replace){r.replaceRequested=true;r.replacement_before_description=expected.description||'';}await refresh(r);if(!['ready','already_present'].includes(r.state))throw Error('帰属確定後のプレビューを確認してください');status('この1件の帰属を確定しました。新しい確認データとDBバックアップを保存・確認してから転記してください。');}
   catch(e){r.state='held';r.reason=e.code||e.message;status('帰属の処理結果を確認してください。同じ確定操作の再送は停止しました。');}
   finally{downloaded=false;$('backup').checked=false;sending=false;dialog.close();}
  });
  document.body.append(dialog);dialog.showModal();status('予定日時と4項目を確認し、この1件だけの帰属を判断してください。');
 }catch(e){r.state='held';r.reason=e.message;status(e.message);busy=false;render();dialog?.remove();}
}

async function apply(r){
 if(busy||r.dispatched||r.state!=='ready'||!downloaded||!$('backup').checked)return;
 busy=true;r.dispatched=true;render();status('この1件を照合して転記しています。再送は行いません。');
 try{const result=await call('apply',{plan:r.preview.plan});if(!['verified','already_present'].includes(result.status))throw Error('保存後の確認結果が不明です');r.result=result;r.state=result.status;status('保存後の再取得・照合が完了しました。');}
 catch(e){r.state='held';r.reason=e.code||e.message;status('処理を停止しました。保存結果が不明な場合も再送せず、管理者が照合してください。');}
 finally{busy=false;render();}
}
watchAuth({onSignedIn:()=>{authenticated=true;status('本人のログインを確認しました。最初に対象を確認してください。');render();},onSignedOut:()=>{authenticated=false;status('授業管理で既存の本人アカウントにログインしてください。');render();}});
