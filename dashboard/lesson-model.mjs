import {lessonEventRef,lessonEventKey,sameLessonEvent} from '../shared/lesson-plan.js';
import {attributedLessonRecord} from '../shared/lesson-attribution.js';
import {offsetDay} from './model.mjs';

// Existing browser-session APIs only. The dashboard never receives an API key.
export function lessonApi({session,isCurrent,signal,fetcher=fetch,onUnauthorized=()=>{}}) {
 return async (path,options={})=>{
  if(!isCurrent())throw new DOMException('stale session','AbortError');
  const write=options.method==='PUT',controller=new AbortController();
  if(!write)signal?.throwIfAborted();
  const abort=()=>controller.abort();if(!write)signal?.addEventListener('abort',abort,{once:true});
  let timer;
  const operation=(async()=>{
   const res=await fetcher('/api'+path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session}`},...(!write?{signal:controller.signal}:{})});
   if(!res.ok){if(res.status===401)onUnauthorized();const e=new Error(`取得・保存できません (${res.status})`);e.status=res.status;try{const d=await res.json();e.current=d.current;e.message=d.error||e.message;}catch{}throw e;}
   const result=res.status===204?null:await res.json();
   if(!write)signal?.throwIfAborted();
   if(!isCurrent())throw new DOMException('stale session','AbortError');
   return result;
  })();
  try {return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{if(!write)abort();const e=new Error(write?'保存結果を確認できません。再送せず内容を確認してください。':'取得に時間がかかっています');e.unknown=write;reject(e);},20000);})]);}
  catch(e){if(write&&!e.status)e.unknown=true;throw e;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
}

export async function homeLessonModel(data,day,{api,googleToken,signal,fetcher=fetch}) {
 if(data.unconfigured||!data.events.length)return {...data,day,rows:[],periods:[],calendars:[]};
 const [terms,periods]=await Promise.all([api('/terms'),api('/periods')]);
 if(!Array.isArray(terms)||!Array.isArray(periods))throw new Error('授業設定を確認できませんでした');
 const settings=data.settings,selected=new Set((settings.selected_term_ids||[]).map(Number));
 const term=terms.find(t=>selected.has(t.id)&&day>=t.start_date&&day<=t.end_date);
 const start=term?.start_date||offsetDay(day,-90),end=offsetDay(term?.end_date||offsetDay(day,90),1);
 const token=await googleToken();signal.throwIfAborted();if(!token)throw new Error('カレンダーへのログインを確認してください');
 const calendarAbort=new AbortController();signal.addEventListener('abort',()=>calendarAbort.abort(),{once:true});if(signal.aborted)calendarAbort.abort();
 async function google(url){const r=await fetcher(url,{headers:{Authorization:`Bearer ${token}`},signal:calendarAbort.signal,cache:'no-store'});if(!r.ok)throw new Error(`カレンダーを取得できません (${r.status})`);return r.json();}
 let calendars=[],calendarPage='',calendarPages=new Set();
 do {const q=new URLSearchParams({maxResults:'250'});if(calendarPage)q.set('pageToken',calendarPage);const d=await google('https://www.googleapis.com/calendar/v3/users/me/calendarList?'+q);if(!Array.isArray(d.items))throw new Error('カレンダー名を確認できません');calendars.push(...d.items);calendarPage=d.nextPageToken||'';if(calendarPage&&(typeof calendarPage!=='string'||calendarPages.has(calendarPage)))throw new Error('カレンダー一覧の続きが不正です');calendarPages.add(calendarPage);}while(calendarPage);
 if(settings.selected_calendars.includes('primary')&&!calendars.some(c=>c.id==='primary')){const primary=calendars.filter(c=>c.primary===true);if(primary.length===1)calendars.push({...primary[0],id:'primary'});}
 if(settings.selected_calendars.some(id=>calendars.filter(c=>c.id===id).length!==1))throw new Error('選択中のカレンダー名を確認できません。授業管理で設定を確認してください。');

 const range=[];const ids=[...new Set(settings.selected_calendars)];let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{while(cursor<ids.length){const id=ids[cursor++];let page='',seen=new Set();do{const q=new URLSearchParams({timeMin:start+'T00:00:00+09:00',timeMax:end+'T00:00:00+09:00',singleEvents:'true',orderBy:'startTime',maxResults:'250'});if(page)q.set('pageToken',page);const d=await google(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${q}`);if(d.items!==undefined&&!Array.isArray(d.items))throw new Error('予定の応答を確認できません');range.push(...(d.items||[]).filter(e=>e.status!=='cancelled'&&!(settings.excluded_titles||[]).includes((e.summary||'').trim())).map(e=>({...e,_calendarId:id})));page=d.nextPageToken||'';if(page&&(typeof page!=='string'||seen.has(page)))throw new Error('予定の続きが不正です');seen.add(page);}while(page);}})).catch(e=>{calendarAbort.abort();throw e;});
 function unique(events){const map=new Map();for(const event of events){const ref=lessonEventRef(event),key=lessonEventKey(ref),previous=map.get(key);if(previous&&!sameLessonEvent(lessonEventRef(previous),ref))throw new Error('取得中に予定が変更されました。再取得してください。');if(!previous)map.set(key,event);}return [...map.values()];}
 const dayEvents=unique(data.events),rangeEvents=unique(range);
 const dayStart=Date.parse(day+"T00:00:00+09:00"),dayEnd=Date.parse(offsetDay(day,1)+"T00:00:00+09:00");
 if(dayEvents.some(e=>Date.parse(e.end?.dateTime||e.end?.date)<=dayStart||Date.parse(e.start?.dateTime||e.start?.date)>=dayEnd))throw new Error("日付範囲外の予定が含まれています。再取得してください。");
 for(const event of dayEvents){const peer=rangeEvents.find(item=>lessonEventKey(lessonEventRef(item))===lessonEventKey(lessonEventRef(event)));if(!peer||!sameLessonEvent(lessonEventRef(peer),lessonEventRef(event)))throw new Error('日別と期間内の予定が一致しません。再取得してください。');}
 const sorted=rangeEvents.sort((a,b)=>String(a.start?.dateTime||a.start?.date).localeCompare(String(b.start?.dateTime||b.start?.date)));
 if(sorted.some(e=>typeof e.id!=='string'||!Number.isFinite(Date.parse(e.start?.dateTime||e.start?.date))||!Number.isFinite(Date.parse(e.end?.dateTime||e.end?.date))))throw new Error('期間内の予定を確認できません');
 const rows=dayEvents.map(ev=>{if(typeof ev.id!=='string'||!ev.id||!ids.includes(ev._calendarId)||!Number.isFinite(Date.parse(ev.start?.dateTime||ev.start?.date))||!Number.isFinite(Date.parse(ev.end?.dateTime||ev.end?.date)))throw new Error('予定の識別情報を確認できません');const label=(ev.summary||'(無題)').trim(),ref=lessonEventRef(ev);const series=sorted.filter(e=>e._calendarId===ref.calendar_id&&(e.summary||'').trim()===label);const index=series.findIndex(e=>e.id===ref.id);return {eventId:ev.id,ref,calendarId:ref.calendar_id,label,termId:term?.id||'',n:index+1||1,m:series.length||1,start:ref.start,iconColor:/^#[0-9a-f]{6}$/i.test(calendars.find(c=>c.id===ref.calendar_id)?.backgroundColor||'')?calendars.find(c=>c.id===ref.calendar_id).backgroundColor:'',previous:index>0?series[index-1]:null};});
 const targets=[...new Map(rows.flatMap(r=>[r.ref,...(r.previous?[lessonEventRef(r.previous)]:[])]).map(ref=>[lessonEventKey(ref),ref])).values()];
 let entries=[];const calendarsById=new Map();for(const event of [...rangeEvents,...dayEvents]){const set=calendarsById.get(event.id)||new Set();set.add(event._calendarId);calendarsById.set(event.id,set);}
 const collisions=new Set([...calendarsById].filter(([,ids])=>ids.size>1).map(([id])=>id)),unavailable=new Set();
 // Small observations keep each existing Worker invocation bounded; no bulk initialization.
 for(let i=0;i<targets.length;i++){entries=await api('/lesson-records',{method:'POST',body:JSON.stringify({targets:targets.slice(i,i+1)})});if(!Array.isArray(entries))throw new Error('授業記録の応答を確認できません');for(const r of entries){if(r.record_collision)collisions.add(r.calendar_event_id);if(r.record_target_unavailable)unavailable.add(r.calendar_event_id);}}
 const records=new Map(entries.map(r=>[r.calendar_event_id,{...r,...(collisions.has(r.calendar_event_id)?{record_collision:true}:{}),...(unavailable.has(r.calendar_event_id)?{record_target_unavailable:true}:{})}]));
 for(const r of rows){r.record=attributedLessonRecord(collisions.has(r.eventId)?{...records.get(r.eventId),calendar_event_id:r.eventId,record_collision:true}:records.get(r.eventId),r.ref);if(!Number.isSafeInteger(r.record.record_revision))throw new Error('授業記録の版を確認できません');r.completed=!!r.record.completed;r.lessonPlan=r.record.lesson_plan||'';r.confirmationTest=r.record.confirmation_test||'';r.homework=r.record.homework||'';r.lessonMemo=r.record.lesson_memo||'';r.prevRecord=r.previous?attributedLessonRecord(records.get(r.previous.id),lessonEventRef(r.previous)):{};r.prevLessonPlan=r.prevRecord.lesson_plan||'';}
 return {day,rows,periods,calendars,settings};
}
