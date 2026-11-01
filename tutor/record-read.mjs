let active=0;const waiting=[];
function acquire(signal){return new Promise((resolve,reject)=>{const run=()=>{signal.removeEventListener('abort',abort);active++;let released=false;resolve(()=>{if(released)return;released=true;active--;waiting.shift()?.();});};const abort=()=>{const index=waiting.indexOf(run);if(index>=0)waiting.splice(index,1);reject(Object.assign(new Error('読み取りを中止しました'),{code:'READ_TIMEOUT'}));};if(signal.aborted)return abort();if(active<4)run();else{waiting.push(run);signal.addEventListener('abort',abort,{once:true});}});}
// Read-only work has bounded concurrency and deadlines; writes never use this helper.
export async function boundedRead(items, read, {concurrency=4,timeout=15000,isCurrent=()=>true,onProgress=()=>{}}={}) {
 const results=new Array(items.length);let next=0,done=0,stopped=false;
 const stale=()=>Object.assign(new Error('表示対象が変わりました'),{code:'STALE_READ'});
 async function worker(){while(!stopped&&next<items.length){if(!isCurrent())throw stale();const index=next++,controller=new AbortController();let timer,release=()=>{};
  try{results[index]=await Promise.race([Promise.resolve().then(async()=>{release=await acquire(controller.signal);try{if(controller.signal.aborted||stopped||!isCurrent())throw stale();return await read(items[index],controller.signal);}finally{release();}}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();release();reject(Object.assign(new Error('読み取りが時間内に完了しませんでした。日付を切り替えて再読込してください'),{code:'READ_TIMEOUT'}));},timeout);})]);if(stopped||!isCurrent())throw stale();onProgress(++done,items.length);}
  catch(error){stopped=true;throw error;}finally{clearTimeout(timer);}
 }}
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));return results;
}
export function precedingLegacyEvents(dayEvents,rangeEvents,read){
 const found=[];for(const event of dayEvents){if(read(event)?.record_storage==='d1_owner')continue;const time=Date.parse(event.start?.dateTime||event.start?.date);
 const previous=rangeEvents.filter(e=>e._calendarId===event._calendarId&&(e.summary||'').trim()===(event.summary||'').trim()&&Date.parse(e.start?.dateTime||e.start?.date)<time).sort((a,b)=>Date.parse(b.start?.dateTime||b.start?.date)-Date.parse(a.start?.dateTime||a.start?.date))[0];if(previous)found.push(previous);}
 return found;
}
export function precedingOwnerEvents(event,records,rangeEvents){
 const time=Date.parse(event.start?.dateTime||event.start?.date);
 return records.filter(r=>r.calendar_id&&r.event_id&&Date.parse(r.lesson_date)<time).sort((a,b)=>Date.parse(b.lesson_date)-Date.parse(a.lesson_date)).map(r=>rangeEvents.find(e=>e.id===r.event_id&&e._calendarId===r.calendar_id)).filter(Boolean).slice(0,1);
}
