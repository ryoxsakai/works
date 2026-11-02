// A revision acknowledges the complete shared record snapshot, never only its number.
const fields=['test','homework','memo'];
export function recordRowPrefix(row){return row.querySelector('.record-test')?'record':'curriculum';}
export function recordRowSnapshot(row){
 const view=recordRowPrefix(row),checkbox=row.querySelector('.curriculum-completed');
 return {view,revision:Number(row.dataset.recordRevision),values:Object.fromEntries(fields.map(k=>[k,row.querySelector('.'+view+'-'+k).value])),completed:checkbox?checkbox.checked:row.dataset.completed==='1'};
}
function independent(row,saved){
 const view=recordRowPrefix(row),checkbox=row.querySelector('.curriculum-completed');
 return fields.some(k=>{const input=row.querySelector('.'+view+'-'+k);return input.value!==input.defaultValue&&input.value!==saved.values[k];})
  ||!!checkbox&&checkbox.checked!==checkbox.defaultChecked&&checkbox.checked!==saved.completed;
}
export function independentRecordRows(rows,saved,sourceRow){
 return rows.filter(row=>row!==sourceRow&&independent(row,saved)).map(recordRowSnapshot);
}
export function synchronizeRecordRows(rows,saved,sourceRow){
 const dirtyRows=rows.filter(row=>row!==sourceRow&&independent(row,saved)),held=dirtyRows.map(recordRowSnapshot);
 for(const row of rows){
  const view=recordRowPrefix(row);if(dirtyRows.includes(row))continue;
  for(const key of fields){const input=row.querySelector('.'+view+'-'+key);input.value=saved.values[key];input.defaultValue=saved.values[key];}
  const checkbox=row.querySelector('.curriculum-completed');if(checkbox){checkbox.checked=saved.completed;checkbox.defaultChecked=saved.completed;}
  row.dataset.completed=saved.completed?'1':'0';row.dataset.recordRevision=saved.revision;
 }
 return held;
}
