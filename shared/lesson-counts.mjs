import {isScheduledLesson,lessonEventRef,sameLessonEvent} from './lesson-plan.js';
import {lessonTitleKey} from './lesson-attribution.js';

// Counts are schedule positions, not proof that records have the same owner.
export function sameNameLessonCount(current, events, excluded = []) {
 const ref=lessonEventRef(current), title=lessonTitleKey(ref.title);
 if(!isScheduledLesson(ref,excluded))return {n:'—',m:'—'};
 const seen=new Map();
 for(const event of events){
  const item=lessonEventRef(event);
  if(event.recurrence||item.calendar_id!==ref.calendar_id||lessonTitleKey(item.title)!==title||!isScheduledLesson(item,excluded))continue;
  const previous=seen.get(item.id);
  if(previous&&!sameLessonEvent(previous,item))return {n:'—',m:'—'};
  seen.set(item.id,item);
 }
 const list=[...seen.values()].sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)||a.id.localeCompare(b.id));
 const index=list.findIndex(item=>item.id===ref.id&&sameLessonEvent(item,ref));
 if(index<0||list.some((item,i)=>i>0&&Date.parse(item.start)===Date.parse(list[i-1].start)))return {n:'—',m:'—'};
 return {n:index+1,m:list.length};
}
