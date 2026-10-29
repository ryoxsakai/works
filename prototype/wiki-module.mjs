import view from './wiki-view.html?raw';import './wiki-native.css';import {esc,renderMarkdown} from '../wiki/markdown.js';import {createFolderBrowser} from './wiki-folders.mjs';import {createWikiReview} from './wiki-review.mjs';import {assertWikiAck,validWikiDetail,reviewedProposal,safeWikiUrl} from './wiki-model.mjs';
export function mountWiki(root,context,{id,folder=null,routeUrl='/wiki/',navigate}){
let alive=true,pendingRoute=null,previousOverflow;const lifecycle=new AbortController(),remembered=(context.workspaceState ||= {}).wiki ||= {query:'',archived:false};root.classList.add('wiki-native');root.innerHTML='<p><a class="external" href="/wiki/">従来のWiki画面へ ↗</a></p>'+view;const page=root.closest('.page-content');
function showDialog(d){if(!root.querySelector('dialog[open]')&&page){previousOverflow=page.style.overflow;page.style.overflow='hidden';}if(!d.open)d.showModal();}
function hideDialog(d){d.close();if(!root.querySelector('dialog[open]')&&page)page.style.overflow=previousOverflow||'';}
const review=createWikiReview(root,{busy:()=>state.busy,showDialog,hideDialog}),{compare,closeReview}=review;
function selectPanel(name){review.selectPanel(name);state.panel=name;}
const $ = (id) => root.querySelector("#"+CSS.escape(id)),
  state = {
    data: null,
    pages: [],
    offset: 0,
    busy: false,
    dirty: false,
    editing: false,
    dialogDirty: false,
  };
const path = (id) => encodeURIComponent(id);
function markEditorDirty() {
  state.dirty = true;
  $("save-state").textContent = "未保存の変更があります";
}
function notify(s, error = false) {
  $("message").textContent = s;
  $("message").classList.toggle("error", error);
}
async function api(p,body){if(!alive)throw new DOMException('Wiki closed','AbortError');if(body&&state.stopped)throw Error('保存を停止しています。最新状態の確認と明示的な再読込が必要です。');const attempt=body?{endpoint:p,body:structuredClone(body),previous:structuredClone(state.data)}:null;try{const value=await context.request('/api/wiki/'+p,{method:body?'POST':'GET',body,signal:lifecycle.signal});if(!alive)throw new DOMException('Wiki closed','AbortError');if(body){assertWikiAck(p,body,value,attempt.previous);state.needsRefresh=true;state.attempt={...attempt,acknowledged:true,result:structuredClone(value)};}return value;}catch(e){if(!alive)throw e;if(body&&![400,413].includes(e.status)){state.stopped=true;state.attempt={...attempt,acknowledged:false};recovery();}throw e;}}
async function run(fn){if(state.busy||state.leaving||!alive)return;const returnFocus=document.activeElement;state.busy=true;controls();notify('');try{await fn();if(!alive)return;state.needsRefresh=false;if(!state.stopped)state.attempt=null;}catch(e){if(!alive)return;if(state.needsRefresh){state.stopped=true;recovery();}notify(e.message,true);if($('review-dialog').open)$('review-message').textContent=e.message;}finally{if(alive){state.busy=false;controls();const dialog=root.querySelector('dialog[open]');if(dialog&&document.activeElement===dialog)dialog.querySelector('input:not([disabled]),button:not([disabled])')?.focus();else if(document.activeElement===document.body){if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus();else if(!$('detail').hidden)$('title').focus({preventScroll:true});}if(pendingRoute&&!state.stopped){const to=pendingRoute;pendingRoute=null;remembered.nextPanel=state.data?{id:state.data.page.id,panel:state.panel}:null;state.leaving=true;controls();navigate(to.url,to.options);}}}}
function guard() {
  if (state.busy) {
    notify("操作が完了するまでお待ちください。");
    return false;
  }
  return (
    !(state.dirty || state.dialogDirty) ||
    confirm("未保存の入力を破棄しますか？")
  );
}
function beforeNavigate() {
  if (!guard()) return false;
  state.dirty = false;
  state.editing = false;
  state.dialogDirty = false;
  $("editor").hidden = true;
  root.classList.remove("wiki-editing");
  hideDialog($("folder-dialog"));
  closeReview();
  return true;
}
const folders = createFolderBrowser({
 root,showDialog,hideDialog,signal:lifecycle.signal,readExpanded:()=>remembered.expanded||[],writeExpanded:value=>remembered.expanded=value,initialView:remembered.folderView,viewChanged:mode=>remembered.folderView=mode,
  api,
  run,
  beforeNavigate,
  busy: () => state.busy,
  page: () => state.data?.page,
  archived: () => $("archives").checked,
  dialogDirty: (v) => (state.dialogDirty = v),
  isDialogDirty: () => state.dialogDirty,
  navigate: (id) => run(() => chooseFolder(id)),
  reload: () => load(),
  moved: async (id, target) => {
    folders.setCurrent(target);
    await open(id);
  },
});
const canonical=(folder,page)=>'/wiki/'+(page?encodeURIComponent(page)+'/':'')+(folder?'?folder='+encodeURIComponent(folder):'');
function route(folder,page,push=true){if(!push)return;const url=canonical(folder,page);if(url!==routeUrl)pendingRoute={url,options:{}};}
async function chooseFolder(id, push = true) {
  folders.setCurrent(id);
  $("search").value = "";
  $("detail").hidden = true;
  root.classList.remove("wiki-focused");remembered.focused=false;
  $("focus-reading").setAttribute("aria-pressed", "false");
  $("focus-reading").textContent = "集中表示";
  state.data = null;
  await load();
  route(folders.current(), null, push);
}
function previewMode(mode) {
  const preview = mode === "preview";
  $("body-label").hidden = preview;
  $("editor-preview").hidden = !preview;
  if (preview)
    $("editor-preview").innerHTML = renderMarkdown(
      $("editor").elements.body.value,
    );
  for (const m of ["edit", "preview"]) {
    $("mode-" + m).setAttribute("aria-pressed", String(m === mode));
    $("mode-" + m).classList.toggle("active", m === mode);
  }
}
$("mode-edit").onclick = () => previewMode("edit");
$("mode-preview").onclick = () => previewMode("preview");
$("back-folders").onclick = () => {
  if (beforeNavigate()) run(() => chooseFolder(folders.current()));
};
async function load(more = false, refresh = true) {
  if (!more && refresh) await folders.refresh();
  const offset = more ? state.offset : 0;
  const data = await api(
    "pages?q=" +
      encodeURIComponent($("search").value) +
      "&archived=" +
      $("archives").checked +
      "&offset=" +
      offset +
      (!$("search").value
        ? "&folder_id=" + encodeURIComponent(folders.current() || "")
        : ""),
  );
  state.pages = more ? [...state.pages, ...data.pages] : data.pages;
  state.offset = offset + data.pages.length;
  $("clear-search").hidden = !$("search").value;
  $("folder-grid").hidden = Boolean($("search").value);
  if ($("search").value)
    $("folder-heading").textContent = "検索結果（全フォルダ）";

  $("more").hidden = !data.has_more;
  $("pages").innerHTML =
    state.pages
      .map(
        (p) =>
          `<button data-page="${esc(p.id)}"><span class="wiki-page-title">${esc(p.title)}</span><small>${esc(folders.label(p.folder_id))} · ${p.status === "confirmed" ? "確認済み" : "下書き"} · r${p.revision}${p.archived ? " · アーカイブ" : ""}</small></button>`,
      )
      .join("") ||
    ($("search").value
      ? '<p class="wiki-empty">一致するページがありません。<br>別のキーワードで検索してください。</p>'
      : '<p class="wiki-empty">ページはまだありません。<br>「＋ 新規ページ」から知識をまとめましょう。</p>');
  $("page-count").textContent =
    `${state.pages.length}件${data.has_more ? "以上" : ""}のページ${$("search").value ? " · 全フォルダから検索" : ""}`;
  remembered.query=$("search").value;remembered.archived=$("archives").checked;
  selectCurrentPage();
}
function selectCurrentPage() {
  const id = state.data?.page.id;
  root
    .querySelectorAll("#pages [data-page], #folder-tree [data-page]")
    .forEach((button) => {
      if (id && button.dataset.page === id)
        button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
}
function render() {
  const { page: p, proposals, history } = state.data;
  $("detail").hidden = false;
  $("move-page").hidden = !!p.archived;
  $("title").textContent = p.title;
  $("meta").textContent =
    `${folders.label(p.folder_id)} · ${p.status === "confirmed" ? "確認済み" : "下書き"} · revision ${p.revision} · ${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "medium", timeStyle: "short" }).format(new Date(p.updated_at))}${p.archived ? " · アーカイブ" : ""} · タグ: ${p.tags.join(", ")} · 別名: ${p.aliases.join(", ")}`;
  $("current-version").textContent =
    `▤ 現在の本文 · r${p.revision} · ${p.status === "confirmed" ? "✓ 確認済み" : "✎ 下書き（未確認）"}${p.archived ? " · アーカイブ" : ""}`;
  $("body").innerHTML = renderMarkdown(p.body);
  const headings = [...$("body").querySelectorAll("h1,h2,h3")];
  $("page-outline").hidden = headings.length < 2;
  $("page-toc").replaceChildren(
    ...headings.map((heading, index) => {
      heading.id = "wiki-section-" + index;
      const link = document.createElement("a");
      link.href = "#" + heading.id;
      link.textContent = heading.textContent;
      link.className = "toc-level-" + heading.tagName.toLowerCase();
      link.addEventListener("click", (event) => {
        event.preventDefault();
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        heading.scrollIntoView({ block: "start" });
      });
      return link;
    }),
  );
  const pending = proposals.filter((v) => v.status === "pending").length;
  $("tab-proposals").textContent =
    `✎ 改稿案${pending ? `（確認待ち ${pending}）` : ""}`;
  $("proposal-heading").textContent = pending
    ? `改稿案 · 確認待ち ${pending}件`
    : "改稿案";
  $("sources").innerHTML =
    p.sources
      .map(
        (s) =>
          `<div class="source">${esc(s.type)} · ${esc(s.id)}${safeWikiUrl(s.url) ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">原本URL</a>` : s.url?` · ${esc(s.url)}`:""}<br>${esc(s.location)} · 確認日 ${esc(s.checked_at)}</div>`,
      )
      .join("") || "<p>出典なし</p>";
  $("links").innerHTML =
    p.links
      .map(
        (id) =>
          `<button data-page="${esc(id)}">${esc(state.pages.find((p) => p.id === id)?.title || folders.pageTitle(id) || id)}</button>`,
      )
      .join("") || "<p>なし</p>";
  $("proposals").innerHTML =
    proposals
      .map(
        (v) =>
          `<div class="proposal"><p>${esc(v.notes)} · 元r${v.base_revision} · ${{ pending: "確認待ち", accepted: "採用済み", rejected: "却下済み" }[v.status] || esc(v.status)}</p><button data-compare-proposal="${esc(v.id)}">差分を確認</button>${v.status === "pending" ? `<button data-accept="${esc(v.id)}">採用</button><button data-reject="${esc(v.id)}">却下</button>` : ""}</div>`,
      )
      .join("") || "<p>なし</p>";
  $("history").innerHTML = history
    .map(
      (h) =>
        `<div>r${h.revision} · ${esc(h.created_at)} <button data-history="${h.revision}">現在と比較</button><button data-restore="${h.revision}">新しい版として復元</button></div>`,
    )
    .join("");
  $("comparison").innerHTML = "";
  $("more-history").hidden = !state.data.history_has_more;
  selectCurrentPage();
}
async function open(id, push = true) {
  const value=await api("pages/"+path(id));if(!validWikiDetail(value,id))throw Error("ページの対象・版を確認できません。");state.data=value;
  root.querySelector(".wiki-page-tools").open = false;
  state.dirty = false;
  state.editing = false;
  $("editor").hidden = true;
  root.classList.remove("wiki-editing");
  await folders.refresh();
  folders.setCurrent(state.data.page.folder_id);
  await load(false, false);
  render();
  selectPanel("content");
  route(folders.current(), id, push);
  $("title").focus({ preventScroll: true });
  $("detail").scrollIntoView({ block: "start" });
}
function addSource(
  s = {
    type: "other",
    id: "",
    url: "",
    location: "",
    checked_at: new Date().toISOString().slice(0, 10),
  },
) {
  const div = document.createElement("div");
  div.className = "source";
  div.innerHTML = `<label>種別<select name="source-type">${["onedrive", "exam", "vocab", "works", "web", "other"].map((t) => `<option ${t === s.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>${[
    ["id", "原本ID"],
    ["url", "原本URL"],
    ["location", "箇所"],
    ["checked_at", "確認日"],
  ]
    .map(
      ([k, l]) =>
        `<label>${l}<input name="source-${k}" value="${esc(s[k])}" ${k === "checked_at" ? 'type="date"' : ""} ${["location", "checked_at"].includes(k) ? "required" : ""}></label>`,
    )
    .join(
      "",
    )}<button type="button" class="remove-source">この出典を削除</button>`;
  div.querySelector("button").onclick = () => {
    div.remove();
    markEditorDirty();
  };
  $("source-fields").append(div);
}
function edit(isNew = false) {
  state.editing = true;
  $("save-state").textContent = "編集中 · 保存すると反映されます";
  state.new = isNew;
  state.editId = isNew ? null : state.data.page.id;
  state.editRevision = isNew ? null : state.data.page.revision;
  state.dirty = false;
  const p = isNew
    ? {
        title: "",
        body: "",
        tags: [],
        aliases: [],
        links: [],
        status: "draft",
        sources: [],
      }
    : state.data.page;
  for (const k of ["title", "body", "status"])
    $("editor").elements[k].value = p[k];
  for (const k of ["tags", "aliases", "links"])
    $("editor").elements[k].value = p[k].join(", ");
  $("source-fields").innerHTML = "";
  p.sources.forEach(addSource);
  $("propose").hidden = isNew;
  $("proposal-notes").value = "";
  $("editor-heading").textContent = isNew ? "新規ページ" : "ページ編集";
  state.createFolder = folders.current();
  state.createFolderRevision = folders.folder(state.createFolder)?.revision;
  previewMode("edit");
  $("editor").hidden = false;
  root.classList.add("wiki-editing");
  $("editor").scrollIntoView({ block: "start" });
  $("editor").elements.title.focus({ preventScroll: true });
}
function content() {
  const form = $("editor"),
    c = {};
  for (const k of ["title", "body", "status"]) c[k] = form.elements[k].value;
  for (const k of ["tags", "aliases", "links"])
    c[k] = form.elements[k].value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  c.sources = [...$("source-fields").children].map((div) =>
    Object.fromEntries(
      ["type", "id", "url", "location", "checked_at"].map((k) => [
        k,
        div.querySelector(`[name="source-${k}"]`).value,
      ]),
    ),
  );
  return c;
}
$("editor").oninput = () => {
  markEditorDirty();
  if (!$("editor-preview").hidden)
    $("editor-preview").innerHTML = renderMarkdown(
      $("editor").elements.body.value,
    );
};
$("editor").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const c = content();
    state.data = await api(
      state.new ? "pages" : "pages/" + path(state.editId) + "/save",
      state.new
        ? {
            ...c,
            folder_id: state.createFolder,
            folder_revision: state.createFolderRevision,
          }
        : { revision: state.editRevision, content: c },
    );
    state.dirty = false;
    state.editing = false;
    $("editor").hidden = true;
    root.classList.remove("wiki-editing");
    render();
    await load();
    selectPanel("content");
    route(state.data.page.folder_id, state.data.page.id);
    $("title").focus({ preventScroll: true });
    $("detail").scrollIntoView({ block: "start" });
    notify("保存しました。");
  });
};
$("propose").onclick = () =>
  run(async () => {
    if (state.new) throw new Error("先にページを作成してください。");
    await api("pages/" + path(state.editId) + "/proposals", {
      base_revision: state.editRevision,
      content: content(),
      notes: $("proposal-notes").value,
    });
    state.dirty = false;
    await open(state.editId);
    selectPanel("proposals");
    notify("改稿案を保存しました。本文は採用時に更新されます。");
  });
$("add-source").onclick = () => {
  addSource();
  markEditorDirty();
};
$("cancel").onclick = () => {
  if (guard()) {
    state.dirty = false;
    state.editing = false;
    $("editor").hidden = true;
    root.classList.remove("wiki-editing");
    (state.data ? $("edit") : $("new")).focus();
  }
};
$("more-history").onclick = () =>
  run(async () => {
    const h = await api(
      "pages/" +
        path(state.data.page.id) +
        "/history?offset=" +
        state.data.history.length,
    );
    state.data.history.push(...h.history);
    state.data.history_has_more = h.has_more;
    render();
  });
$("clear-search").onclick = () => {
  if (!beforeNavigate()) return;
  run(async () => {
    $("search").value = "";
    await chooseFolder(folders.current(), false);
    $("search").focus();
  });
};
$("find").onclick = () => run(() => load());
$("search").onkeydown = (e) => {
  if (e.key === "Enter") run(() => load());
};
$("archives").onchange = () => run(() => load());
$("more").onclick = () => run(() => load(true));
$("new").onclick = () => {
  if (guard()) edit(true);
};
$("edit").onclick = () => {
  if (guard()) edit();
};
$("archive").onclick = () => {
  if (guard() && confirm("このページをアーカイブしますか？"))
    run(async () => {
      state.dirty = false;
      state.editing = false;
      $("editor").hidden = true;
      root.classList.remove("wiki-editing");
      state.data = await api("pages/" + path(state.data.page.id) + "/archive", {
        revision: state.data.page.revision,
      });
      render();
      await load();
    });
};
$("workspace").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || state.busy) return;
  const d = b.dataset;
  if (d.page && guard()) return run(() => open(d.page));
  if (!state.data) return;
  const p = state.data.page;
  if(d.acceptReviewed&&(!$("review-dialog").open||!reviewedProposal(review.binding,state.data,d.acceptReviewed))){notify("確認した差分と現在の版が一致しません。最新の内容から確認し直してください。",true);return;}
  if (d.compareProposal) {
    const v = state.data.proposals.find((v) => v.id === d.compareProposal);
    compare(
      p,
      { ...p, ...v.content },
      "現在の本文と改稿案",
      v.status === "pending" ? v.id : null,
      folders.label,
    );
  }
  if (d.history) {
    const h = state.data.history.find((h) => h.revision === Number(d.history));
    compare(h.snapshot, p, `r${h.revision} と現在`, null, folders.label);
  }
  if (d.accept) {
    const v = state.data.proposals.find((v) => v.id === d.accept);
    compare(
      p,
      { ...p, ...v.content },
      "採用前に変更を確認",
      v.id,
      folders.label,
    );
    return;
  }
  for (const action of ["accept", "reject", "restore"])
    if ((action === "accept" ? d.acceptReviewed : d[action]) && guard()) {
      const actionId = action === "accept" ? d.acceptReviewed : d[action];
      if (
        confirm(
          action === "accept"
            ? "差分と出典を確認しました。改稿案を採用しますか？"
            : action === "restore"
              ? "過去の内容を新revisionとして復元しますか？"
              : "改稿案を却下しますか？",
        )
      )
        return run(async () => {
          state.dirty = false;
          state.editing = false;
          $("editor").hidden = true;
          root.classList.remove("wiki-editing");
          state.data = await api("pages/" + path(p.id) + "/" + action, {
            revision: p.revision,
            ...(action === "restore"
              ? { target_revision: Number(actionId) }
              : { proposal_id: actionId }),
          });
          closeReview(true);
          folders.setCurrent(state.data.page.folder_id);
          render();
          await load();
          route(folders.current(), state.data.page.id);
        });
    }
  if(d.export&&['markdown','json'].includes(d.export))run(async()=>{const blob=await context.request('/api/wiki/pages/'+path(p.id)+'/export?format='+d.export,{responseType:'blob',signal:lifecycle.signal});if(!alive)return;const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='wiki-'+p.id+(d.export==='markdown'?'.md':'.json');a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
};
$("focus-reading").onclick = () => {
  const focused = root.classList.toggle("wiki-focused");remembered.focused=focused;
  $("focus-reading").setAttribute("aria-pressed", String(focused));
  $("focus-reading").textContent = focused ? "一覧も表示" : "集中表示";
  $("detail").scrollIntoView({ block: "start" });
};

function controls(){if(!alive)return;$('workspace').setAttribute('aria-busy',String(state.busy));for(const el of root.querySelectorAll('button,input,select,textarea')){if(el.tagName==='INPUT'&&el.closest('#body,#editor-preview,#comparison')){el.disabled=true;continue;}const safe=el.dataset.wikiSafe!==undefined||['review-close','review-done','folder-dialog-close','folder-dialog-cancel'].includes(el.id);el.disabled=state.busy||state.leaving||(!safe&&(!state.ready||state.stopped));}}
function recovery(){if(!alive)return;for(const box of root.querySelectorAll('[data-wiki-recovery]'))box.hidden=!state.stopped;}
function exportDraft(){const value={attempt:state.attempt,data:state.data,editor:content(),folder:[...$('folder-form').querySelectorAll('input,select')].map(el=>[el.id,el.value]),review:review.binding};const u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='works-wiki-unsaved.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
for(const host of [$('workspace'),$('folder-dialog'),$('review-dialog')]){const box=document.createElement('div');box.dataset.wikiRecovery='';box.hidden=true;box.innerHTML='<p role="alert">保存を停止しています。自動再送せず、入力を書き出して最新の状態を確認してください。</p><button data-wiki-safe data-wiki-export>未保存JSONを保存</button><button data-wiki-safe data-wiki-inspect>最新の保存内容を確認</button><button data-wiki-safe data-wiki-reset>入力を破棄して最新を開く</button><pre hidden></pre>';host.prepend(box);}
root.addEventListener('click',e=>{const button=e.target.closest('[data-wiki-export],[data-wiki-inspect],[data-wiki-reset]');if(!button||state.busy)return;if(button.hasAttribute('data-wiki-export')){exportDraft();return;}if(button.hasAttribute('data-wiki-inspect')){run(async()=>{const data={folders:await api('folders'),page:state.data?.page?.id?await api('pages/'+path(state.data.page.id)):null,pages:await api('pages?offset=0&archived=true')};const pre=button.closest('[data-wiki-recovery]').querySelector('pre');pre.hidden=false;pre.textContent=JSON.stringify(data,null,2);});return;}if(!confirm('未保存または保存結果未確認の入力を破棄し、最新の内容を開きますか？'))return;run(async()=>{await api('folders');if(state.data?.page?.id){const latest=await api('pages/'+path(state.data.page.id));if(!validWikiDetail(latest,state.data.page.id))throw Error('最新のページを確認できません。');}state.stopped=false;state.attempt=null;state.needsRefresh=false;state.dirty=state.dialogDirty=state.editing=false;hideDialog($('folder-dialog'));closeReview(true);pendingRoute={url:routeUrl,options:{reloadCurrent:true}};});},{signal:lifecycle.signal});
if(!id)remembered.focused=false;root.classList.toggle('wiki-focused',!!remembered.focused);$('focus-reading').setAttribute('aria-pressed',String(!!remembered.focused));$('focus-reading').textContent=remembered.focused?'一覧も表示':'集中表示';
$('search').value=remembered.query||'';$('archives').checked=!!remembered.archived;
async function initial(){await run(async()=>{await folders.refresh();folders.setCurrent(folder);await load();if(id){await open(id,false);const next=remembered.nextPanel;remembered.nextPanel=null;if(next?.id===id&&['content','proposals','history'].includes(next.panel))selectPanel(next.panel);}state.ready=true;});if(!alive||state.ready)return;const b=document.createElement('button');b.textContent='再試行';b.dataset.wikiSafe='';b.onclick=()=>{b.remove();initial();};$('message').append(b);}
initial();
return {get dirty(){return state.busy||state.dirty||state.dialogDirty||state.stopped;},canLeave(){return !state.busy&&(!(state.dirty||state.dialogDirty||state.stopped)||confirm('未保存または保存結果未確認の入力を破棄して移動しますか？'));},unmount(){alive=false;lifecycle.abort();for(const d of root.querySelectorAll('dialog[open]'))d.close();if(page)page.style.overflow=previousOverflow||'';state.data=null;state.pages=[];state.attempt=null;root.replaceChildren();context.metrics.unmounts++;}};
}
