export const snapshotFields = {
  admission: ['university','selection_type','stage','schedule_date','end_date','notes','source_url','color'],
  files: ['name','material_code','folder_id','sort_order'],
  folders: ['name','parent_id','sort_order'],
};
export const statusLabels={planned:'計画のみ',queued:'未着手',running:'進行中',review:'本人の確認待ち',waiting:'待機',paused:'一時停止',completed:'完了',cancelled:'中止'};
export function expectedSnapshot(type,row){return Object.fromEntries(snapshotFields[type].map(key=>{if(row[key]===undefined)throw new Error('競合確認用の情報が不足しています。更新して確認してください。');return [key,row[key]];}));}
export function serviceFields(kind,type){
 if(kind==='admission')return [['university','大学名',200,'text',true],['schedule_date','日付',10,'date',true],['end_date','終了日',10,'date',false],['notes','補足',10000,'textarea',false]];
 if(kind==='material')return type==='folders'?[['name','分類名',120,'text',true]]:[['name','教材名',255,'text',true],['material_code','教材コード',64,'text',false]];
 return type==='roles'?[['name','役割名',100,'text',true],['responsibilities','責任・仕事内容',2000,'textarea',true],['completion','完了条件',2000,'textarea',true]]:[['title','仕事名',200,'text',true],['purpose','目的',4000,'textarea',true],['completion','全体の完了条件',4000,'textarea',true]];
}
export function canEditService(kind,type,row){return !!row&& (kind!=='flow'||(type==='roles'?!row.archived:type==='definitions'&&!row.archived&&!row.enabled));}
export function serviceEditPayload(kind,type,row,input){
 if(!canEditService(kind,type,row))throw new Error('この項目は統合画面から編集できません。');
 const clean={};for(const [key,,max,,required]of serviceFields(kind,type)){const value=input[key];if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new Error('入力内容を確認してください。');clean[key]=value.trim();}
 if(kind==='admission'){const valid=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;if(!valid(clean.schedule_date)||(clean.end_date&&!valid(clean.end_date))||(clean.end_date&&clean.end_date<clean.schedule_date))throw new Error('日付と終了日の順序を確認してください。');clean.end_date ||= null;clean.notes ||= null;}
 if(kind==='flow')return {action:type==='roles'?'role_edit':'edit',[type==='roles'?'role_id':'definition_id']:row.id,revision:row.revision,content:{...structuredClone(row.data),...clean}};
 return {...clean,expected:expectedSnapshot(kind==='admission'?'admission':type,row)};
}
export function safeSource(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function folderPath(folders,id){const names=[],seen=new Set();while(id){if(seen.has(id)){names.unshift('分類情報を確認');break;}seen.add(id);const row=folders.find(f=>f.id===id);if(!row){names.unshift('不明な分類');break;}names.unshift(row.name);id=row.parent_id;}return names.join(' / ')||'未分類';}
