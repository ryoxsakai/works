export const digest=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export function snapshotScope(manifest,supplemental){
 if(!manifest?.operation_reference||!Array.isArray(manifest.groups)||!Array.isArray(manifest.calendars)||!Array.isArray(manifest.exclusions)||!Array.isArray(supplemental))throw Error('対象一覧の形式が不正です');
 const calendars=new Map(manifest.calendars.map(c=>[c.calendar_ref,c.calendar_id]));if(calendars.size!==manifest.calendars.length)throw Error('カレンダーが重複しています');
 const included=manifest.groups.flatMap(g=>g.records.map(r=>({calendar_ref:g.calendar_ref,event_id:r.event_id,category:'approved'}))),excluded=manifest.exclusions.map(r=>({...r,category:'excluded'})),extras=supplemental.map(r=>({...r,category:'additional_empty'}));
 if(included.length!==119||excluded.length!==2||extras.length!==2||manifest.counts?.records!==119||manifest.counts?.excluded!==2)throw Error('承認済み119件・除外2件・別枠2件が揃っていません');
 const rows=[...included,...excluded,...extras].map(r=>({calendar_ref:r.calendar_ref,event_id:r.event_id,category:r.category,calendar_id:calendars.get(r.calendar_ref)}));
 if(rows.some(r=>typeof r.event_id!=='string'||!r.event_id||!r.calendar_id)||new Set(rows.map(r=>JSON.stringify([r.calendar_id,r.event_id]))).size!==rows.length)throw Error('対象の欠落・重複があります');return rows;
}
export async function collectSnapshot(manifestText,supplementalText,read,{progress=()=>{},timeoutMs=20000}={}){
 const manifest=JSON.parse(manifestText),rows=snapshotScope(manifest,JSON.parse(supplementalText)),started=new Date().toISOString(),result=new Array(rows.length);let index=0,completed=0,failure=null;
 async function worker(){while(!failure){const i=index++;if(i>=rows.length)return;const row=rows[i];let timer;const controller=new AbortController();try{
  const event=await Promise.race([read(row,controller.signal),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('取得時間を超えました。ファイルは保存していません。再取得してください'));},timeoutMs);})]);
  if(event.calendar_id!==row.calendar_id||event.event_id!==row.event_id||event.raw_event?.id!==row.event_id||!event.raw_event.etag||!event.raw_event.start||!event.raw_event.end||['status','created','updated','iCalUID'].some(k=>typeof event.raw_event[k]!=='string'||!event.raw_event[k])||event.raw_event.recurringEventId&&!event.raw_event.originalStartTime||event.raw_event.recurrence||typeof event.raw_event.description!=='string'&&event.raw_event.description!==undefined||event.raw_description_sha256!==await digest(event.raw_event.description??''))throw Error('原文・変更識別情報・hashの照合に失敗しました');
  result[i]={...event,calendar_ref:row.calendar_ref};completed++;progress(completed,rows.length);
 }catch(error){failure=error;}finally{clearTimeout(timer);controller.abort();}}}
 await Promise.all(Array.from({length:4},worker));if(failure)throw failure;if(completed!==rows.length||result.some(r=>!r))throw Error('取得が完了していません');
 return {format:1,operation_reference:manifest.operation_reference,scope_manifest_sha256:await digest(manifestText),supplemental_manifest_sha256:await digest(supplementalText),capture_started_at:started,capture_completed_at:new Date().toISOString(),complete:true,counts:{approved:119,excluded:2,additional_empty:2},events:result.filter((_,i)=>rows[i].category!=='additional_empty'),additional_empty_events:result.filter((_,i)=>rows[i].category==='additional_empty')};
}
export function installSnapshotExport({api,action,status}){
 const form=document.getElementById('snapshot-export');form.onsubmit=event=>{event.preventDefault();action(async()=>{
  document.getElementById('snapshot-result').textContent='';
  const scope=form.elements.scope.files[0],extra=form.elements.supplemental.files[0];if(!scope||!extra||scope.size>1048576||extra.size>1048576)throw Error('確認済みの対象一覧と別枠一覧（各1MB以内）を選択してください');
  const manifestText=await scope.text(),supplementalText=await extra.text(),snapshot=await collectSnapshot(manifestText,supplementalText,(row,signal)=>api('/lesson-history/snapshot/event?'+new URLSearchParams({calendar_id:row.calendar_id,event_id:row.event_id}),undefined,'GET',signal),{progress:(n,total)=>status('バックアップ原文を取得しています '+n+' / '+total+'件')});
  const text=JSON.stringify(snapshot,null,2)+'\n',hash=await digest(text),blob=new Blob([text],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='works-calendar-snapshot-'+snapshot.capture_completed_at.replace(/[:.]/g,'-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  document.getElementById('snapshot-result').textContent='123件の取得完了。119対象＋除外2件、別枠2件。ファイルの保存先を確認してください。\nSHA256: '+hash+'\n取得終了: '+snapshot.capture_completed_at;
 });};
}
