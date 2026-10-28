// Preserve the statuses and JST deadline ordering used by ss/app.js.
export const statusOrder={'原稿待ち':0,'素材案作成中':1,'素材案確認待ち':2,'問題作成中':3,'完了':4};
export function visibleProjects(projects,{query='',completed=false,sort='deadline',direction='asc'}={}) {
  return projects.filter(project=>(completed||project.status!=='完了')&&
    `${project.name} ${project.memo}`.includes(query.trim())).sort((a,b)=>{
      const compare=sort==='status'?(statusOrder[a.status]??99)-(statusOrder[b.status]??99):
        sort==='name'?a.name.localeCompare(b.name,'ja'):sort==='remaining'?remainingDays(a)-remainingDays(b):a.deadline.localeCompare(b.deadline);
      return compare*(direction==='desc'?-1:1)||a.name.localeCompare(b.name,'ja');
    });
}
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function remainingDays(project){
 if(Number.isFinite(project.remaining_days))return project.remaining_days;
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return Math.round((Date.parse(project.deadline+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
}
export function remainingLabel(project){const days=remainingDays(project);return project.status==='完了'?'完了':!Number.isFinite(days)?'期限未定':days<0?Math.abs(days)+'日超過':days===0?'本日':`あと${days}日`;}
