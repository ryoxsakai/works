// Offline only. This command cannot authenticate, fetch or write Google/D1.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {planCalendarRecordMigration} from './src/calendar-lesson-migration.js';
export function migrationDryRun(snapshot){
 if(!snapshot||!Array.isArray(snapshot.records)||!Array.isArray(snapshot.events)||!Array.isArray(snapshot.privacy)||typeof snapshot.ownerEmail!=='string')throw Error('records/events/privacy/ownerEmail snapshot required');
 const byId=new Map();for(const event of snapshot.events){const list=byId.get(event.id)||[];list.push(event);byId.set(event.id,list);}
 const items=snapshot.records.map(row=>{
  const events=byId.get(row.calendar_event_id)||[],event=events.length===1?events[0]:null;
  const result=events.length>1?{status:'held',reason:'event_id_collision'}:planCalendarRecordMigration({row,event,privacy:snapshot.privacy.find(p=>p.calendar_id===event?.calendar_id),ownerEmail:snapshot.ownerEmail,excluded:snapshot.excluded||[]});
  return {event_id:row.calendar_event_id,calendar_id:event?.calendar_id||null,record_revision:row.record_revision,...result};
 });
 const counts={};for(const item of items)counts[item.status]=(counts[item.status]||0)+1;
 return {format:1,cutoff:'2026-10-20T00:00:00+09:00',created_at:new Date().toISOString(),counts,items,executed:0,ownership_inferred:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node calendar-lesson-dry-run.mjs PRIVATE_INPUT.json PRIVATE_NEW_OUTPUT.json');
 const inputStat=await stat(input),folderStat=await stat(dirname(output));
 if(inputStat.mode&0o077||folderStat.mode&0o077)throw Error('Private input0600 and destination directory0700 required');
 const result=migrationDryRun(JSON.parse(await readFile(input,'utf8')));
 await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({counts:result.counts,executed:0}));
}
