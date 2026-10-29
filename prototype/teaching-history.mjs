import {recordDateRange,shiftRecordDate} from '../tutor/record-date.js';
import {lessonEventRef,sameLessonEvent} from '../shared/lesson-plan.js';
import {validDay} from './teaching-model.mjs';
// Mirrors Tutor loadRecordTable: first selected covering term, otherwise +/-90
// civil days; title matching is trim-only, deliberately not next-link NFKC matching.
export function teachingScope(day,settings,terms=[]){
 if(!validDay(day))throw new Error('授業日を確認してください。');
 if(!Array.isArray(terms)||terms.some(row=>!row||typeof row.start_date!=='string'||typeof row.end_date!=='string'))throw new Error('学期の情報を確認してください。');
 const selected=new Set(settings.selected_term_ids||[]),term=terms.find(row=>selected.has(row.id)&&day>=row.start_date&&day<=row.end_date);
 const first=term?term.start_date:shiftRecordDate(day,-90),last=term?term.end_date:shiftRecordDate(day,90);
 if(!validDay(first)||!validDay(last)||first>last)throw new Error('学期の期間を確認してください。');
 return {first,last,term:term?{id:term.id,label:term.label}:null,range:recordDateRange(first,last)};
}
export const excludedLesson=(event,settings)=>new Set(settings.excluded_titles||[]).has((event.summary??event.title??'').trim());
export function teachingHistory(current,events,settings){
 const ref=lessonEventRef(current),raw=events.map(event=>lessonEventRef(event)).filter(event=>event.status!=='cancelled');
 if(raw.some(event=>event.id===ref.id&&event.calendar_id!==ref.calendar_id))return {state:'collision',previous:null};
 const title=(current.summary||current.title||'(無題)').trim(),selected=raw.filter(event=>!excludedLesson(event,settings)&&event.calendar_id===ref.calendar_id&&(event.title||'').trim()===title).sort((a,b)=>(a.start||'').localeCompare(b.start||''));
 const own=raw.find(event=>event.calendar_id===ref.calendar_id&&event.id===ref.id);
 if(own&&!sameLessonEvent(own,ref))return {state:'changed',previous:null};
 const identities=selected.map(event=>event.id);if(new Set(identities).size!==identities.length)return {state:'duplicate',previous:null};
 const index=selected.findIndex(event=>event.id===ref.id),previous=index>0?selected[index-1]:null;
 const count={n:index+1||1,m:selected.length||1};
 if(previous&&(raw.some(event=>event.id===previous.id&&event.calendar_id!==previous.calendar_id)||selected.filter(event=>Date.parse(event.start)===Date.parse(previous.start)).length>1||Date.parse(previous.start)===Date.parse(ref.start)))return {...count,state:'ambiguous',previous:null};
 return {...count,state:index<0?'missing':'ready',previous};
}
export function teachingPeriod(start,periods=[]){
 if(/^\d{4}-\d{2}-\d{2}$/.test(start||''))return '終日';
 const date=new Date(start);if(!Number.isFinite(date.getTime()))return '時刻未確認';
 const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(date);
 let match;for(const period of periods.filter(row=>row&&typeof row.start_time==='string'&&typeof row.label==='string').sort((a,b)=>a.start_time.localeCompare(b.start_time))){if(period.start_time>clock)break;match=period;}
 return match?.label||clock;
}

// Tutor curriculum date presentation, pinned to the same JST day axis as shell routing.
export function curriculumDate(start,periods=[]){const date=new Date(start);if(!Number.isFinite(date.getTime()))return start||'';const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(date),get=type=>parts.find(part=>part.type===type)?.value;const weekdays={Sun:'日',Mon:'月',Tue:'火',Wed:'水',Thu:'木',Fri:'金',Sat:'土'};return `${get('month')}/${get('day')} (${weekdays[get('weekday')]}) ${teachingPeriod(start,periods)}`;}
