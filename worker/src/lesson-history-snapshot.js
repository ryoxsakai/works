// Read-only backup: deliberately independent of migration planning/initialization.
const allowed=['id','summary','description','start','end','etag','status','created','updated','iCalUID','recurringEventId','originalStartTime','eventType','transparency','recurrence','sequence'];
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
export async function sha256(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function readSnapshotEvent(env,{calendar_id,event_id},deps,{timeoutMs=15000}={}){
 if(env.LESSON_HISTORY_MODE!=='reconcile')throw fail('バックアップは書込み停止中に取得してください');
 for(const value of [calendar_id,event_id])if(typeof value!=='string'||!value||value.length>1024)throw fail('カレンダーと個別予定IDが必要です',400);
 const controller=new AbortController();let timer;
 const work=async()=>{
  const settings=await deps.settings();if(!settings.selected_calendars?.includes(calendar_id))throw fail('選択されていないカレンダーです',403);
  // Only retained legacy records, including reviewed exclusions and extra empty rows.
  const source=await env.DB.prepare('SELECT calendar_event_id FROM curriculum_entries WHERE calendar_event_id=?').bind(event_id).first();if(!source)throw fail('保存済み原記録がありません',404);
  const token=await deps.token();if(controller.signal.aborted)throw fail('取得がタイムアウトしました',504);
  const event=await deps.event(token.access_token,calendar_id,event_id,{signal:controller.signal});
  if(!event||event.id!==event_id||typeof event.etag!=='string'||!event.etag||!event.start||!event.end||event.recurrence)throw fail('個別予定の完全な原文を取得できませんでした');
  if(['status','created','updated','iCalUID'].some(k=>typeof event[k]!=='string'||!event[k])||event.recurringEventId&&!event.originalStartTime)throw fail('個別予定の識別情報が欠落しています');
  if(event.description!==undefined&&typeof event.description!=='string')throw fail('説明原文が不正です');
  const raw_event=Object.fromEntries(allowed.filter(k=>Object.hasOwn(event,k)).map(k=>[k,event[k]]));
  raw_event.declined=!!event.attendees?.some(a=>a.self&&a.responseStatus==='declined');
  const operation=await env.DB.prepare("SELECT id,status,snapshot_json FROM calendar_lesson_migration WHERE calendar_id=? AND event_id=? ORDER BY rowid DESC LIMIT 1").bind(calendar_id,event_id).first();
  if(operation&&operation.status!=='verified')throw fail('未確定のカレンダー操作があります');
  let generation=null;if(operation){let s;try{s=JSON.parse(operation.snapshot_json);}catch{throw fail('操作履歴を確認できません');}generation=s.after_generation??s.binding?.generation??null;}
  return {event_id,calendar_id,raw_event,raw_description_sha256:await sha256(event.description??''),binding_generation:generation,source_verified_operation_id:operation?.id||null,parsed_values:null,parsed_values_reason:'原文を保存し、復元済みD1と組合せて照合します',captured_at:new Date().toISOString()};
 };
 try{return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(fail('取得がタイムアウトしました。保存せず、再取得してください',504));},timeoutMs);})]);}finally{clearTimeout(timer);controller.abort();}
}
