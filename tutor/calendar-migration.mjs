import {watchAuth,getSessionToken} from '../shared/auth.js?v=12';
const $=id=>document.getElementById(id),records=[];let authenticated=false,busy=false,downloaded=false,scanned=false;
const status=text=>{$('status').textContent=text;};
async function call(path,body){
 const token=getSessionToken();if(!authenticated||!token)throw Error('既存の本人ログインが必要です');
 const response=await fetch('/api/calendar-lesson-migration/'+path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const value=await response.json();if(!response.ok){const error=Error(value.error||'取得・保存できません ('+response.status+')');error.code=value.code;throw error;}return value;
}
function render(){
 $('scan').disabled=!authenticated||busy||records.some(r=>r.dispatched);$('download').disabled=!scanned||busy;
 $('backup').disabled=!downloaded||busy;
 const counts={};for(const r of records)counts[r.state]=(counts[r.state]||0)+1;
 $('summary').textContent=Object.entries(counts).map(([k,n])=>k+': '+n+'件').join(' / ');
 $('items').replaceChildren(...records.map(r=>{const li=document.createElement('li'),text=document.createElement('span');text.textContent=(r.preview?.event_before?.summary||r.event_id)+' — '+r.state+(r.reason?' ('+r.reason+')':'');li.append(text);
  if(r.state==='ready'){const button=document.createElement('button');button.textContent='この1件を転記する';button.disabled=busy||!downloaded||!$('backup').checked||r.dispatched;button.addEventListener('click',()=>apply(r));li.append(button);}return li;}));
}
$('scan').addEventListener('click',async()=>{
 if(busy)return;busy=true;scanned=false;downloaded=false;$('backup').checked=false;records.length=0;render();status('予定とDBの対応を確認しています。書き込みは行いません。');
 try{let cursor='',done=false;const seen=new Set();while(!done){const page=await call('records?cursor='+encodeURIComponent(cursor));if(!Array.isArray(page.items))throw Error('対象一覧の形式を確認できません');for(const item of page.items){if(typeof item.calendar_event_id!=='string'||seen.has(item.calendar_event_id))throw Error('対象一覧の重複を確認してください');seen.add(item.calendar_event_id);records.push({event_id:item.calendar_event_id,state:'pending'});}done=page.done===true;if(!done&&(!page.next_cursor||page.next_cursor===cursor))throw Error('一覧の続きが確認できません');cursor=page.next_cursor;}
  for(const r of records){try{r.preview=await call('preview',{event_id:r.event_id});r.state=r.preview.plan.status;r.reason=r.preview.plan.reason;if(r.state==='ready'&&(r.preview.event_before.description||'').trim()){r.state='held';r.reason='existing_description';}}catch(e){r.state='held';r.reason=e.message;}render();}
  scanned=true;status('確認が完了しました。確認データを非公開で保存してから、転記可能な予定を1件ずつ処理してください。');
 }catch(e){status(e.message);}finally{busy=false;render();}
});
$('download').addEventListener('click',()=>{
 if(!scanned||busy)return;const blob=new Blob([JSON.stringify({format:1,cutoff:'2026-10-20T00:00:00+09:00',captured_at:new Date().toISOString(),records},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='works-calendar-private-snapshot.json';a.click();URL.revokeObjectURL(url);downloaded=true;render();
});
$('backup').addEventListener('change',render);
async function apply(r){
 if(busy||r.dispatched||r.state!=='ready'||!downloaded||!$('backup').checked)return;
 busy=true;r.dispatched=true;render();status('この1件を照合して転記しています。再送は行いません。');
 try{const result=await call('apply',{plan:r.preview.plan});if(!['verified','already_present'].includes(result.status))throw Error('保存後の確認結果が不明です');r.result=result;r.state=result.status;status('保存後の再取得・照合が完了しました。');}
 catch(e){r.state='held';r.reason=e.code||e.message;status('処理を停止しました。保存結果が不明な場合も再送せず、管理者が照合してください。');}
 finally{busy=false;render();}
}
watchAuth({onSignedIn:()=>{authenticated=true;status('本人のログインを確認しました。最初に対象を確認してください。');render();},onSignedOut:()=>{authenticated=false;status('授業管理で既存の本人アカウントにログインしてください。');render();}});
