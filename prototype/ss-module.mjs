import {visibleProjects,escapeHtml as esc} from './ss-model.mjs';
export function mountSS(root,context,{id,navigate}) {
  const lifecycle=new AbortController();
  context.metrics.mounts++;
  let disposed=false,dirty=false,saving=false,projects=[],requestId=crypto.randomUUID();
  root.innerHTML='<div class="loading" role="status">SS案件を読み込んでいます…</div>';
  function render() {
    const selected=projects.find(project=>project.id===id);
    root.innerHTML=`<div class="ss-layout ${id?'has-selection':''}"><section class="project-browser" aria-label="案件一覧">
      <div class="section-line"><h2>案件一覧 <span>${projects.filter(p=>p.status!=='完了').length}</span></h2><span class="muted">締切が近い順</span></div>
      <label class="search">案件を検索<input type="search" id="project-search" placeholder="案件名・メモで検索"></label>
      <div class="list-options"><label><input id="show-completed" type="checkbox"> 完了を表示</label><label>並べ替え<select id="project-sort"><option value="deadline">締切日</option><option value="status">進捗</option><option value="name">案件名</option></select></label></div><div id="project-list"></div></section>
      <section class="project-detail" aria-label="案件の詳細">${selected?`
        <a href="/ss/" class="mobile-back">← 案件一覧</a><div class="detail-label"><span class="status">${esc(selected.status)}</span><span>${esc(selected.subject)}</span></div>
        <h2 tabindex="-1">${esc(selected.name)}</h2><p class="detail-date">締切 ${esc(selected.deadline.replaceAll('-',' / '))}</p>
        <div class="progress-label"><span>進行状況</span><strong>${selected.progress}%</strong></div><progress value="${selected.progress}" max="100" aria-label="進行状況"></progress>
        <h3>案件メモ</h3><p class="project-memo">${esc(selected.memo)}</p>
        <form id="draft-form"><label for="trial-note">試作メモ</label><p class="muted">この試験画面を開いている間だけ保持します。SS本体は更新されません。</p><textarea id="trial-note" rows="4" placeholder="次に確認することをメモ">${esc(context.draft(id))}</textarea><div class="detail-actions"><button type="submit" class="primary">試作メモを保存</button><button type="button" id="print-project">印刷</button></div><p id="draft-status" role="status"></p></form>
      `:`<div class="detail-empty"><span>▤</span><h2>${id?'案件が見つかりません':'案件を選んで詳細を確認'}</h2><p>${id?'一覧からサンプル案件を選び直してください。':'締切・進捗・メモをひとつの画面で。'}</p><a href="/ss/">案件一覧へ</a></div>`}</section></div>`;
    function list() {
      const visible=visibleProjects(projects,{query:root.querySelector('#project-search').value,completed:root.querySelector('#show-completed').checked,sort:root.querySelector('#project-sort').value});
      root.querySelector('#project-list').innerHTML=visible.length?visible.map(project=>`<a class="project-card ${project.id===id?'selected':''}" href="/ss/${project.id}/" ${project.id===id?'aria-current="page"':''}><div><span class="subject">${esc(project.subject)}</span><span class="card-date">${esc(project.deadline.slice(5).replace('-','/'))} 締切</span></div><h3>${esc(project.name)}</h3><div><span class="status ${project.status==='素材案確認待ち'?'review':''}">${esc(project.status)}</span><span class="card-arrow">↗</span></div></a>`).join(''):'<div class="empty-state"><h3>表示する案件はありません</h3><p>検索条件や「完了を表示」を確認してください。</p></div>';
    }
    list();
    for(const selector of ['#project-search','#show-completed','#project-sort'])root.querySelector(selector).addEventListener('input',list,{signal:lifecycle.signal});
    const note=root.querySelector('#trial-note');
    note?.addEventListener('input',()=>{dirty=note.value!==context.draft(id);root.querySelector('#draft-status').textContent=dirty?'未保存の編集があります':'';},{signal:lifecycle.signal});
    root.querySelector('#draft-form')?.addEventListener('submit',async event=>{
      event.preventDefault();if(saving||!dirty)return;saving=true;
      const button=root.querySelector('button[type="submit"]'),text=note.value;button.disabled=true;note.disabled=true;
      try{await context.save(id,text,requestId);if(disposed)return;dirty=false;requestId=crypto.randomUUID();root.querySelector('#draft-status').textContent='試作メモを保存しました';}
      finally{saving=false;if(!disposed){button.disabled=false;note.disabled=false;}}
    },{signal:lifecycle.signal});
    root.querySelector('#print-project')?.addEventListener('click',()=>window.print(),{signal:lifecycle.signal});
  }
  context.list({signal:lifecycle.signal}).then(data=>{if(!disposed){projects=data;render();}}).catch(error=>{
    if(disposed||error.name==='AbortError')return;
    root.innerHTML=`<div class="empty-state" role="alert"><h2>案件を表示できません</h2><p>${esc(error.message)}</p><button id="retry-projects">再試行</button></div>`;
    root.querySelector('#retry-projects').onclick=()=>navigate(id?`/ss/${id}/`:'/ss/',{reloadCurrent:true});
  });
  return {
    canLeave(){return !saving&&(!dirty||confirm('未保存の試作メモがあります。保存せずに移動しますか？'));},
    get dirty(){return dirty||saving;},
    unmount(){if(disposed)return;disposed=true;lifecycle.abort();context.metrics.unmounts++;root.replaceChildren();},
  };
}
