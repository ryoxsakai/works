// Offline only. Generate private deployment SQL; never contact Calendar or D1.
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function activationSql(config) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(config?.effective_date || '') || new Date(config.effective_date+'T00:00:00Z').toISOString().slice(0,10)!==config.effective_date) throw new Error('A valid effective_date is required');
  if(!Array.isArray(config.holds) || !config.holds.length) throw new Error('Known-change holds must be installed before activation');
  if(new Set(config.holds.map(hold=>hold.event_id)).size!==config.holds.length) throw new Error('Duplicate held event IDs');
  const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
  for(const hold of config.holds) if(typeof hold.calendar_id!=='string' || !hold.calendar_id || typeof hold.event_id!=='string' || !hold.event_id || hold.reason!=='known_title_change') throw new Error('Each hold requires exact calendar/event IDs and known_title_change reason');
  const inserts=config.holds.map(hold=>`INSERT OR IGNORE INTO lesson_record_hold(event_id,calendar_id,reason)VALUES(${quote(hold.event_id)},${quote(hold.calendar_id)},'known_title_change');`);
  const expected=config.holds.map(hold=>`EXISTS(SELECT 1 FROM lesson_record_hold WHERE event_id=${quote(hold.event_id)} AND calendar_id=${quote(hold.calendar_id)})`).join(' AND ');
  return `-- PRIVATE deployment data. Do not commit. No legacy ownership is verified.\nUPDATE lesson_record_policy SET enabled=0 WHERE id=1;\n${inserts.join('\n')}\nINSERT OR IGNORE INTO lesson_record_policy(id,effective_date,enabled,required_hold_count)VALUES(1,${quote(config.effective_date)},0,${config.holds.length});\nUPDATE lesson_record_policy SET enabled=1 WHERE id=1 AND effective_date=${quote(config.effective_date)} AND required_hold_count=${config.holds.length} AND ${expected};\nSELECT effective_date,enabled,required_hold_count FROM lesson_record_policy WHERE id=1;\n`;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [input,output]=process.argv.slice(2);
  if(!input || !output) throw new Error('Usage: node prepare-lesson-attribution-config.mjs PRIVATE_CONFIG_JSON PRIVATE_OUTPUT_SQL');
  await writeFile(output,activationSql(JSON.parse(await readFile(input,'utf8'))),{mode:0o600});
  await chmod(output,0o600);
}
