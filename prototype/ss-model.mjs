// Preserve the statuses and JST deadline ordering used by ss/app.js.
export const statusOrder={'原稿待ち':0,'素材案作成中':1,'素材案確認待ち':2,'問題作成中':3,'完了':4};
export function visibleProjects(projects,{query='',completed=false,sort='deadline'}={}) {
  return projects.filter(project=>(completed||project.status!=='完了')&&
    `${project.name} ${project.memo}`.includes(query.trim())).sort((a,b)=>{
      const compare=sort==='status'?(statusOrder[a.status]??99)-(statusOrder[b.status]??99):
        sort==='name'?a.name.localeCompare(b.name,'ja'):a.deadline.localeCompare(b.deadline);
      return compare||a.name.localeCompare(b.name,'ja');
    });
}
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
