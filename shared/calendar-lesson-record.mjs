// The Calendar description is HTML-capable. Keep all unmanaged bytes unchanged;
// only our explicitly delimited, escaped plain-text region is owned by Works.
export const CALENDAR_RECORD_START = '<!--Works授業記録 v1-->';
export const CALENDAR_RECORD_END = '<!--/Works授業記録-->';
export const CALENDAR_RECORD_FIELDS = Object.freeze({
  lesson_plan:'授業予定：', confirmation_test:'確認テスト：', homework:'宿題：', lesson_memo:'授業メモ：',
});
export const CALENDAR_RECORD_FROM = '2026-10-20';
const fail = message => Object.assign(new Error(message), {status:409,code:'CALENDAR_RECORD_FORMAT_CONFLICT'});
const escapeHTML = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const unescapeHTML = value => value.replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
const headings = Object.values(CALENDAR_RECORD_FIELDS);
function bindingValue(binding) {
  if (!binding || typeof binding.calendar_id!=='string' || !binding.calendar_id || typeof binding.event_id!=='string' || !binding.event_id
    || typeof binding.title!=='string' || !Number.isSafeInteger(binding.generation) || binding.generation<0) throw fail('授業記録の対応情報が不正です');
  return {calendar_id:binding.calendar_id,event_id:binding.event_id,title:binding.title,generation:binding.generation};
}
export const sameCalendarRecordBinding = (a,b) => JSON.stringify(bindingValue(a))===JSON.stringify(bindingValue(b));
export function calendarRecordValues(record={}) {
  return Object.fromEntries(Object.keys(CALENDAR_RECORD_FIELDS).map(key=>{
    const value=record[key]??'';
    if(typeof value!=='string'||value.length>100000)throw fail('授業記録の値が不正です');
    return [key,value];
  }));
}
function encodeValue(value) {
  // Google descriptions support HTML: escape markup rather than making lesson
  // content executable. Escape structural lines without stripping user text.
  return escapeHTML(value).split('\n').map(line=>/^(?:\\|&lt;!--|授業予定：|確認テスト：|宿題：|授業メモ：)/.test(line)?'\\'+line:line).join('\n');
}
function decodeValue(value) {
  if (/<[^>]*>/.test(value))throw fail('管理欄のHTML編集を確認してください');
  return unescapeHTML(value.split('\n').map(line=>/^\\(?:\\|&lt;!--|授業予定：|確認テスト：|宿題：|授業メモ：)/.test(line)?line.slice(1):line).join('\n'));
}
export function parseCalendarRecord(description='') {
  if(typeof description!=='string')throw fail('予定のメモ欄を確認できません');
  const markers=value=>[...description.matchAll(new RegExp('^'+value+'$','gm'))];
  const starts=markers(CALENDAR_RECORD_START),ends=markers(CALENDAR_RECORD_END);
  if(!starts.length&&!ends.length){if(description.includes(CALENDAR_RECORD_START)||description.includes(CALENDAR_RECORD_END))throw fail('管理欄の境界が不正です');return null;}
  if(starts.length!==1||ends.length!==1)throw fail('管理欄が重複または破損しています');
  const start=starts[0].index,end=ends[0].index;
  if(start>end)throw fail('管理欄の順序が不正です');
  const block=description.slice(start+CALENDAR_RECORD_START.length,end);
  const lines=block.split('\n');
  if(lines.shift()!==''||lines.pop()!=='')throw fail('管理欄の境界が不正です');
  let binding;
  try { binding=bindingValue(JSON.parse(unescapeHTML(lines.shift().replace(/^<!--binding:/,'').replace(/-->$/,'')))); }catch {throw fail('管理欄の対応情報が不正です');}
  const values={},keys=Object.keys(CALENDAR_RECORD_FIELDS);let cursor=0;
  for(let i=0;i<keys.length;i++){
    if(!lines[cursor]?.startsWith(headings[i]))throw fail('管理欄の見出しが不正です');
    const body=[lines[cursor++].slice(headings[i].length)];
    while(cursor<lines.length&&!headings.some(heading=>lines[cursor].startsWith(heading)))body.push(lines[cursor++]);
    values[keys[i]]=decodeValue(body.join('\n'));
  }
  if(cursor!==lines.length)throw fail('管理欄の項目が重複しています');
  return {binding,values,start,end:end+CALENDAR_RECORD_END.length};
}
export function replaceCalendarRecord(description,record,binding,{explicitRebind=false}={}) {
  const parsed=parseCalendarRecord(description),identity=bindingValue(binding),values=calendarRecordValues(record);
  if(parsed&&!sameCalendarRecordBinding(parsed.binding,identity)&&!explicitRebind)throw fail('別の授業に属する管理欄です');
  if(!parsed&&headings.some(heading=>description.includes(heading)))throw fail('既存の授業記述と競合するため自動追記を停止しました');
  const content=[CALENDAR_RECORD_START,'<!--binding:'+escapeHTML(JSON.stringify(identity))+'-->',...Object.entries(CALENDAR_RECORD_FIELDS).map(([key,heading])=>heading+encodeValue(values[key])),CALENDAR_RECORD_END].join('\n');
  if(parsed)return description.slice(0,parsed.start)+content+description.slice(parsed.end);
  return description+(description&& !description.endsWith('\n')?'\n':'')+content;
}
