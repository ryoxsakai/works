import {sortedOriginal,remaining,remainingDays as originalRemainingDays} from './ss-original-model.mjs';
// Preserve the statuses and JST deadline ordering used by ss/app.js.
export const statusOrder={'原稿待ち':0,'素材案作成中':1,'素材案確認待ち':2,'問題作成中':3,'完了':4};
export function visibleProjects(projects,{query='',completed=false,sort='deadline',direction='asc'}={}) {return sortedOriginal(projects,{key:sort,direction}).filter(project=>(completed||project.status!=='完了')&&`${project.name} ${project.memo}`.includes(query.trim()));}
export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function remainingDays(project){return originalRemainingDays(project.deadline);}
export function remainingLabel(project){return remaining(project).text;}
