import {lessonEventRef,isScheduledLesson,sameLessonEvent} from './lesson-plan.js';
import {lessonTitleKey} from './lesson-attribution.js';
export const validCalendarDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validInstant=value=>typeof value==='string'&&validCalendarDate(value.slice(0,10))&&Number.isFinite(Date.parse(value));
const dateKey=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export function semesterForTarget(terms,target,termId){
 if(!validInstant(target.start))throw Error('開始日時を確認してください');
 const day=dateKey(target.start),matches=terms.filter(t=>String(t.id)===String(termId)&&t.start_date<=day&&t.end_date>=day);
 if(matches.length!==1)throw Error('開始予定を含む学期を一つ選択してください');
 const term=matches[0];if(!validCalendarDate(term.start_date)||!validCalendarDate(term.end_date)||term.end_date<term.start_date)throw Error('学期の期間を確認してください');
 return {id:term.id,name:term.name,start_date:term.start_date,end_date:term.end_date};
}
// A proposal is never an ownership proof. The explicit confirmation records IDs,
// parent generation and the exact observations, rather than matching names later.
export function semesterCandidates({events,target,term,excludedTitles=[],excludedIds=[],observations=[],ownerId=null}){
 const excluded=new Set(excludedIds),known=new Map(observations.map(o=>[o.event_id,o])),seen=new Map(),items=[];
 for(const event of events){
  const ref=lessonEventRef(event,target.calendar_id);
  if((event.calendar_id||event._calendarId||target.calendar_id)!==target.calendar_id||lessonTitleKey(ref.title)!==lessonTitleKey(target.title))continue;
  if(!validInstant(ref.start)||!validInstant(ref.end)||Date.parse(ref.end)<=Date.parse(ref.start))throw Error('学期内の予定日時を確認できません');
  const day=dateKey(ref.start);if(day<term.start_date||day>term.end_date)continue;
  if(seen.has(ref.id)){if(!sameLessonEvent(seen.get(ref.id),ref))throw Error('同じ予定IDの取得内容が一致しません');throw Error('学期内の予定が重複しています');}seen.set(ref.id,ref);
  const observed=known.get(ref.id);let reason=null;
  if(!isScheduledLesson(ref,excludedTitles)||event.recurrence||excluded.has(ref.id))reason='excluded';
  else if(observed?.link_exists){
   if(observed.status!=='confirmed'||!observed.owner_id)reason='binding_hold';
   else if(observed.owner_id!==ownerId)reason='other_owner';
  }else if(observed?.legacy)reason='legacy_hold';
  else if(observed?.status&&observed.status!=='owner_unassigned'&&!(observed.status==='confirmed'&&observed.owner_id===ownerId))reason='identity_hold';
  items.push({event_identity:{created:event.created||null,iCalUID:event.iCalUID||null},target:ref,series_id:event.recurringEventId||null,original_time:event.originalStartTime?.dateTime||null,reason,existing_owner_id:observed?.owner_id||null,record_id:observed?.record_id||null});
 }
 items.sort((a,b)=>Date.parse(a.target.start)-Date.parse(b.target.start)||a.target.id.localeCompare(b.target.id));
 const eligible=items.filter(i=>!i.reason);let n=0;for(const item of items)if(!item.reason){item.ordinal=++n;item.total=eligible.length;}
 const selected=items.find(i=>i.target.id===target.id);
 if(!selected||!sameLessonEvent(selected.target,target)||selected.reason)throw Error('開始予定が学期候補に含まれません。予定と所属を再確認してください');
 return {term,items,eligible_count:eligible.length,first_date:eligible[0]?.target.start||null,selected_ordinal:selected.ordinal};
}
