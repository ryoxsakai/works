import view from './ss-view.html?raw';import './ss-native.css';
import {STATUS_CLASSES,escapeHtml,remaining,formatDate,sortedOriginal} from './ss-original-model.mjs';
export function mountSSNative(root,context,{navigate}={}){let alive=true;const lifecycle=new AbortController();context.metrics.mounts++;const prefs=context.viewState ||= {query:'',completed:false,...(()=>{const saved=context.readSort?.();return {sort:saved?.key||'deadline',direction:saved?.direction||'asc'};})()};root.classList.add('ss-native');root.innerHTML=view;
const els = {
  signedIn: root.querySelector("#signed-in"),
  signOut: root.querySelector("#sign-out"),
  userBar: root.querySelector(".user-bar"),
  userAvatar: root.querySelector("#user-avatar"),
  userAvatarFallback: root.querySelector("#user-avatar-fallback"),
  error: root.querySelector("#ss-error"),
  list: root.querySelector("#ss-project-list"),
  empty: root.querySelector("#ss-empty"),
  summary: root.querySelector("#ss-summary"),
  showCompleted: root.querySelector("#show-completed"),
  sortButtons: [...root.querySelectorAll(".ss-sort-button")],
  sortKey: root.querySelector("#project-sort"),
  sortDirection: root.querySelector("#sort-direction"),
};

let projects = [];
let sortState = loadSortState();

function loadSortState(){return {key:prefs.sort,direction:prefs.direction};}
function setSort(key, direction) {
  sortState = { key, direction };
  prefs.sort=key;prefs.direction=direction;context.saveSort?.(sortState);
  render();
}

function sortedProjects(){return sortedOriginal(projects,sortState);}
function renderSortControls() {
  els.sortKey.value = sortState.key;
  const ascending = sortState.direction === "asc";
  els.sortDirection.querySelector("span").textContent = ascending ? "昇順" : "降順";
  els.sortDirection.querySelector("i").className = `bx ${ascending ? "bx-sort-up" : "bx-sort-down"}`;
  els.sortDirection.setAttribute("aria-label", `${ascending ? "降順" : "昇順"}に切り替える`);

  for (const button of els.sortButtons) {
    const active = button.dataset.sortKey === sortState.key;
    const header = button.closest("th");
    header.setAttribute("aria-sort", active ? (ascending ? "ascending" : "descending") : "none");
    button.classList.toggle("active", active);
    button.querySelector("i").className = `bx ${active ? (ascending ? "bx-sort-up" : "bx-sort-down") : "bx-sort-alt-2"}`;
  }
}

function render() {
 if(!alive)return;
  const active = projects.filter((project) => project.status !== "完了").length;
  els.summary.textContent = projects.length ? `進行中 ${active}件／全${projects.length}件` : "";
  const visible = sortedProjects().filter((project) => (els.showCompleted.checked || project.status !== "完了")&&`${project.name} ${project.memo}`.includes(prefs.query.trim()));
 root.querySelector("[data-project-count]").textContent="表示中 "+visible.length+"件";
  els.empty.hidden = visible.length > 0;
  els.empty.querySelector("p").textContent = projects.length && !els.showCompleted.checked
    ? "進行中のプロジェクトはありません。完了案件は「完了を表示」で確認できます。"
    : "登録中のプロジェクトはありません。";
  if(prefs.query.trim()&&!visible.length)els.empty.querySelector("p").textContent="検索条件に一致する案件はありません。";
  renderSortControls();
  els.list.innerHTML = visible.map((project) => {
    const remainingState = remaining(project);
    const statusClass = STATUS_CLASSES[project.status] || "unknown";
    const memo = project.memo || "—";
    return `
      <tr class="ss-project-row" data-project-id="${escapeHtml(project.id)}">
        <td data-label="案件" class="ss-project-name"><a href="/ss/${encodeURIComponent(project.id)}/">${escapeHtml(project.name)}</a></td>
        <td data-label="進捗"><span class="ss-status ss-status-${statusClass}">${escapeHtml(project.status)}</span></td>
        <td data-label="締切日" class="ss-deadline"><time datetime="${escapeHtml(project.deadline)}">${escapeHtml(formatDate(project.deadline))}</time></td>
        <td data-label="のこり期間"><span class="ss-remaining ${remainingState.className}">${escapeHtml(remainingState.text)}</span></td>
        <td data-label="メモ" class="ss-memo ${project.memo ? "" : "empty"}">${escapeHtml(memo)}</td>
      </tr>`;
  }).join("");
}


const retry=document.createElement('button');retry.id='retry-projects';retry.textContent='再試行';retry.hidden=true;els.error.after(retry);
async function load(){root.setAttribute('aria-busy','true');retry.hidden=true;els.error.textContent='';try{const rows=await context.list({signal:lifecycle.signal});if(!alive)return;projects=rows;render();}catch(error){if(alive&&error.name!=='AbortError'){els.error.textContent='案件を表示できません。'+error.message;retry.hidden=false;}}finally{if(alive)root.setAttribute('aria-busy','false');}}retry.onclick=load;
for(const button of els.sortButtons)button.onclick=()=>{const key=button.dataset.sortKey;setSort(key,sortState.key===key&&sortState.direction==='asc'?'desc':'asc');};
els.sortKey.onchange=()=>setSort(els.sortKey.value,'asc');els.sortDirection.onclick=()=>setSort(sortState.key,sortState.direction==='asc'?'desc':'asc');els.showCompleted.checked=prefs.completed;els.showCompleted.onchange=()=>{prefs.completed=els.showCompleted.checked;render();};
root.querySelector('#project-search').value=prefs.query;root.querySelector('#project-search').oninput=e=>{prefs.query=e.target.value;render();};
function cleanupPrint(){delete document.body.dataset.ssPrintView;}root.querySelector('#print-ss-list').onclick=()=>{document.body.dataset.ssPrintView='list';window.print();};window.addEventListener('afterprint',cleanupPrint,{signal:lifecycle.signal});document.addEventListener('visibilitychange',()=>{if(!document.hidden&&projects.length)render();},{signal:lifecycle.signal});load();
return {canLeave:()=>true,dirty:false,unmount(){alive=false;lifecycle.abort();cleanupPrint();projects=[];root.replaceChildren();context.metrics.unmounts++;}};
}
