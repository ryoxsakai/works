const fail=()=>{throw Error('保存の応答を確認できません。自動再送せず入力と操作情報を保持します。');};
const valid=r=>r&&typeof r.id==='string'&&r.id&&Number.isSafeInteger(r.revision)&&r.revision>0;
export function assertKdpAck(path,method,body,result,reviewed){
 const [type,id,action]=path.split('/').map(decodeURIComponent);
 if(action==='reorder'){const key=type==='books'?'chapters':'sections',rows=result?.[key],sent=body[key];if(!Array.isArray(rows)||rows.length!==sent.length||rows.some((r,i)=>!valid(r)||r.id!==sent[i].id||r.revision!==sent[i].revision+1))fail();return;}
 if(type==='proposals'){const p=result?.proposal;if(!valid(p)||p.id!==id||p.revision!==body.revision+1||p.status!==(action==='accept'?'accepted':'rejected'))fail();if(action==='accept'&&(!reviewed||!valid(result.section)||result.section.id!==reviewed.section_id||result.section.revision!==reviewed.base_revision+1||result.section.body!==reviewed.body))fail();return;}
 const key=method==='PATCH'?type.slice(0,-1):action==='restore'?'section':action?action.slice(0,-1):type.slice(0,-1),r=result?.[key];if(!valid(r))fail();
 if(method==='PATCH'||action==='restore'){if(r.id!==id||r.revision!==body.revision+1)fail();}
 if(action&&action!=='restore'){const parent=type==='books'?'book_id':type==='chapters'?'chapter_id':'section_id';if(r[parent]!==id)fail();}
 if(action!=='restore')for(const [k,v] of Object.entries(body))if(k!=='revision'&&r[k]!== (k==='archived'?Number(v):v))fail();
}
export function assertKdpImage(book,file,result){const r=result?.image;if(!r||typeof r.id!=='string'||!r.id||r.book_id!==book||r.content_type!==file.type||r.size!==file.size||r.markdown!==`![画像](kdp-image:${r.id})`)fail();}
