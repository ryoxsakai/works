export const kinds={todo:{title:'ToDo',key:'tasks',name:'name'},memo:{title:'メモ',key:'memos',name:'title'},wiki:{title:'Wiki',key:'pages',name:'title'}};
export function rowsFor(kind,data){const rows=data?.[kinds[kind].key];if(!Array.isArray(rows)||rows.some(r=>!r||typeof r.id!=='string'||typeof r[kinds[kind].name]!=='string'))throw new Error('応答の形式を確認できませんでした。');if(kind!=='wiki'&&(!Number.isSafeInteger(data.revision)||!Array.isArray(data.categories)))throw new Error('保存情報を確認できませんでした。');return rows;}
export function editable(kind,row){return kind==='todo'?{name:row.name,memo:row.memo,status:row.status|| (row.progress===100?'done':row.progress>0?'doing':'pending'),progress:row.progress}:kind==='memo'?{title:row.title,bodies:row.bodies||[row.body||''],notes:row.notes||[row.note||'']}:{title:row.title,body:row.body};}
export function applyEdit(kind,data,id,edit){
 const next=structuredClone(data),rows=rowsFor(kind,next),row=rows.find(r=>r.id===id);if(!row)throw new Error('対象が見つかりません。');
 if(kind==='todo') {if(!edit.name.trim()||edit.name.length>500||edit.memo.length>10000||!['pending','doing','waiting','done'].includes(edit.status)||!Number.isInteger(edit.progress)||edit.progress<0||edit.progress>100)throw new Error('名前・進捗・メモを確認してください。');Object.assign(row,edit);}
 if(kind==='memo'){if(!edit.title.trim()||edit.title.length>500||edit.bodies.some(v=>v.length>100000)||edit.notes.some(v=>v.length>10000))throw new Error('タイトル・本文の長さを確認してください。');Object.assign(row,edit,{updatedAt:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date())});}
 return next;
}
export function matches(kind,row,edit){return !!row&&JSON.stringify(editable(kind,row))===JSON.stringify(edit);}
