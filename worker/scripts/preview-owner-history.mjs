// Offline only: restore a private D1 SQL export, verify additive schema and its
// restoration, then compare raw Calendar descriptions. Never calls a service.
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {parseCalendarRecord,parsePlainCalendarRecord,calendarRecordValues} from '../../shared/calendar-lesson-record.mjs';
import {lessonTitleKey} from '../../shared/lesson-attribution.js';
const [sqlPath,snapshotPath,exclusionsPath,outputDirectory]=process.argv.slice(2);
if(!outputDirectory)throw Error('usage: node scripts/preview-owner-history.mjs private.sql raw-calendar.json exclusions.json private-output-directory');
const out=resolve(outputDirectory);await mkdir(out,{recursive:true,mode:0o700});await chmod(out,0o700);
const schema=new URL('../migrations/lesson-owner-history.sql',import.meta.url).pathname;
const python=String.raw`
import sqlite3,json,pathlib,hashlib,os,sys
sql,schema,out=map(pathlib.Path,sys.argv[1:]);os.umask(0o077)
original=out/'preview.sqlite';restored=out/'restored.sqlite'
if original.exists() or restored.exists(): raise Exception('Use a new private output directory; do not replace prior evidence')
c=sqlite3.connect(original);c.executescript(sql.read_text());assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
def snapshot(db):
 result={}
 for (name,) in db.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name"):
  values=db.execute('select * from "'+name+'"').fetchall()
  result[name]=hashlib.sha256(json.dumps(sorted([json.dumps(r,ensure_ascii=False,default=str) for r in values]),ensure_ascii=False).encode()).hexdigest()
 return result
before=snapshot(c);c.executescript(schema.read_text());after=snapshot(c);assert all(after[k]==v for k,v in before.items())
dump='\n'.join(c.iterdump());backup=out/'additive-schema-backup.sql';backup.write_text(dump)
d=sqlite3.connect(restored);d.executescript(dump);assert d.execute('pragma integrity_check').fetchone()[0]=='ok';assert snapshot(d)==after
c.row_factory=sqlite3.Row
tables={name:[dict(r) for r in c.execute('select * from '+name)] for name in ['curriculum_entries','lesson_record_identity','lesson_record_baseline','calendar_lesson_migration']}
print(json.dumps({'tables':tables,'proof':{'original_tables_unchanged':len(before),'restored_tables_equal':len(after),'integrity_check':'ok','source_count':c.execute('select count(*) from curriculum_entries').fetchone()[0],'student_count':c.execute('select count(*) from students').fetchone()[0],'sql_sha256':hashlib.sha256(sql.read_bytes()).hexdigest()}}))
`;
const run=spawnSync('python3',['-c',python,resolve(sqlPath),schema,out],{encoding:'utf8',maxBuffer:32*1024*1024});if(run.status!==0)throw Error(run.stderr||'Local restore failed');
const {tables,proof}=JSON.parse(run.stdout),raw=JSON.parse(await readFile(snapshotPath,'utf8')),exclusions=JSON.parse(await readFile(exclusionsPath,'utf8'));
const key=(cal,id)=>JSON.stringify([cal,id]),excluded=new Map(exclusions.map(item=>[key(item.calendar_id,item.event_id),item.reason]));
const source=new Map(tables.curriculum_entries.map(row=>[row.calendar_event_id,row])),identities=new Map(tables.lesson_record_identity.map(row=>[row.event_id,row]));
const latest=new Map();for(const row of tables.calendar_lesson_migration){const k=key(row.calendar_id,row.event_id);if(row.status!=='precondition_failed')latest.set(k,row);}
const report=[];for(const row of raw.records){
 const preview=row.preview;if(!preview){report.push({event_id:row.event_id,status:'unavailable',reason:row.reason});continue;}
 const {event_before:event,calendar_id:cal}=preview,id=row.event_id,identity=identities.get(id),old=source.get(id),base={calendar_id:cal,event_id:id,current_title:event.summary,date:event.start?.dateTime||event.start?.date,identity_title:identity?.title||null,owner_id:null,owner_confirmation_required:true,calendar_description_retained:event.description||''};
 if(excluded.has(key(cal,id))){report.push({...base,status:'excluded',reason:excluded.get(key(cal,id))});continue;}
 const op=latest.get(key(cal,id));if(op&&op.status!=='verified'){report.push({...base,status:'held',reason:'pending_operation'});continue;}
 let current=calendarRecordValues(old),origin='legacy_d1';
 if(op){try{const snapshot=JSON.parse(op.snapshot_json),binding={...snapshot.binding,title:lessonTitleKey(snapshot.ref.title),generation:snapshot.after_generation??snapshot.binding.generation};
  if(binding.title!==lessonTitleKey(event.summary))throw Error('title changed');
  const parsed=parseCalendarRecord(event.description||'')||parsePlainCalendarRecord(event.description||'',binding,{prefix:snapshot.managed_prefix||'',suffix:snapshot.managed_suffix||'',allowPrefixEdit:true});if(!parsed||JSON.stringify(parsed.binding)!==JSON.stringify(binding))throw Error('unreadable latest description');current=parsed.values;origin='calendar_latest';
 }catch(error){report.push({...base,status:'held',reason:error.message});continue;}}
 const oldValues=calendarRecordValues(old),changed_fields=Object.keys(current).filter(k=>current[k]!==oldValues[k]);
 report.push({...base,status:'owner_confirmation_required',origin,changed_fields,latest_values:current,original_values:oldValues,original_record:old,verified_calendar_operation:op?.id||null});
}
const counts={};for(const row of report)counts[row.status]=(counts[row.status]||0)+1;
const summary={format:1,operation_reference:'works-d1-owner-history-preview',captured_at:raw.captured_at,prepared_at:new Date().toISOString(),...proof,counts,calendar_latest:report.filter(r=>r.origin==='calendar_latest').length,calendar_vs_d1_different:report.filter(r=>r.origin==='calendar_latest'&&r.changed_fields.length).length,owners_automatically_created:0,records_imported:0,production_writes:0,calendar_writes:0};
await writeFile(out+'/preview.json',JSON.stringify({summary,items:report},null,2),{mode:0o600});await writeFile(out+'/summary.json',JSON.stringify(summary,null,2),{mode:0o600});console.log(JSON.stringify(summary));
