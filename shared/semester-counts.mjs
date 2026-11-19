import {sameLessonEvent} from './lesson-plan.js';
// Count only the fixed owner's verified actual events. Never use a same-name row
// as a fallback when ownership changed or the term read failed.
export async function ownerSemesterCounts(rows,termId,read,isCurrent=()=>true){
 const owners=[...new Set(rows.filter(r=>r.record?.attribution_status==='confirmed'&&r.record?.owner_id).map(r=>r.record.owner_id))],loaded=new Map();let cursor=0;
 await Promise.all(Array.from({length:Math.min(2,owners.length)},async()=>{while(cursor<owners.length&&isCurrent()){const id=owners[cursor++];try{const result=await read('/lesson-history/semester/schedules?'+new URLSearchParams({owner_id:id,term_id:termId}));if(result.owner_id!==id||String(result.term?.id)!==String(termId)||!Array.isArray(result.items))throw Error('invalid semester');loaded.set(id,result);}catch{loaded.set(id,null);}}}));
 return new Map(rows.filter(r=>r.record?.owner_id).map(row=>{const result=loaded.get(row.record.owner_id),item=result?.items.find(i=>i.owner_id===row.record.owner_id&&sameLessonEvent(i.target,row.ref));return [JSON.stringify([row.ref.calendar_id,row.ref.id]),item&&Number.isSafeInteger(item.ordinal)&&item.ordinal>0&&Number.isSafeInteger(item.total)&&item.total>=item.ordinal?{n:item.ordinal,m:item.total}:{n:'—',m:'—'}];}));
}
