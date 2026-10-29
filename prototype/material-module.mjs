import view from './material-view.html?raw';import './material-native.css';
import {materialSnapshot} from '../worker/src/material-library-guarded.js';import {validateMaterialListing,assertMaterialAck,assertMaterialUpload} from './material-model.mjs';
import {createWorkflowDialogs} from './workflow-model.mjs';
export function mountMaterial(root,context,{id,type,navigate}={}){
 let alive=true,busy=false,loading=false,uploadBusy=false,loaded=false,stopped=false,needsRefresh=false,attempt=null,snapshot={folders:[],files:[]},createBase=null,renameBase=null,locks=[],previewGeneration=0;
 const lifecycle=new AbortController();context.metrics.mounts++;root.classList.add('material-native');root.innerHTML='<p><a class="external" href="/material/">従来の教材管理画面へ ↗</a></p>'+view;
 const hideIcons=()=>root.querySelectorAll('i.bx').forEach(icon=>icon.setAttribute('aria-hidden','true'));hideIcons();const icons=new MutationObserver(hideIcons);icons.observe(root,{childList:true,subtree:true});
 const dialogs=createWorkflowDialogs(root,{busy:()=>busy||loading||uploadBusy||stopped}),{showDialog,closeDialog:hideDialog,markDialogSaved}=dialogs;
 function status(){if(alive){root.setAttribute('aria-busy',String(busy||loading||uploadBusy));root.dataset.stopped=String(stopped);}}
 function lock(){if(locks.length)return;locks=[...root.querySelectorAll('input,textarea,select')].map(e=>[e,e.disabled]);for(const [e]of locks)e.disabled=true;}
 function unlock(){for(const [e,value]of locks)if(e.isConnected)e.disabled=value;locks=[];}
 root.addEventListener('click',event=>{if((busy||loading||uploadBusy||stopped)&&!event.target.closest('[data-material-recovery]')){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,signal:lifecycle.signal});
 function canNavigate(){return !busy&&!loading&&!uploadBusy&&(!(stopped||dialogs.dirty()||uploadItems.length)||confirm('未保存の入力・選択ファイルまたは結果未確認の操作があります。破棄して移動しますか？'));}
 async function read(path){try{const value=await context.request('/api/material-library'+path,{signal:lifecycle.signal});if(!alive)throw new DOMException('Material module closed','AbortError');return value;}catch(error){if(alive){stopped=true;recovery();}throw error;}}
 async function mutate(body){if(stopped||busy||loading||uploadBusy||needsRefresh)throw Error('更新を停止しています。');materialSnapshot(body.expected);busy=true;status();lock();const sent=structuredClone(body);attempt={body:sent,acknowledged:false};
 try{const value=await context.request('/api/material-library/guarded',{method:'POST',body:sent,signal:lifecycle.signal});if(!alive)throw new DOMException('Material module closed','AbortError');assertMaterialAck(sent,value);needsRefresh=true;attempt={body:sent,acknowledged:true,result:value};if(value.blob_cleanup==='uncertain'){stopped=true;recovery();}return value;}
 catch(error){if(alive&&![400,413].includes(error.status)){stopped=true;recovery();}throw error;}finally{busy=false;status();if(!needsRefresh&&!stopped)unlock();}}
 function recovery(){if(root.querySelector('[data-material-recovery]'))return;const panel=document.createElement('section');panel.dataset.materialRecovery='';panel.setAttribute('role','alert');panel.innerHTML='<p>競合または保存・ファイル処理の結果が不明なため更新を停止しました。自動で再送しません。同名ファイルがあっても今回の保存成功とは判定しません。</p><button data-inspect>最新を読み取りで確認</button><button data-export>入力と操作情報を保存</button><button data-reset>入力を破棄して再読込</button><pre hidden></pre>';if(attempt?.result?.blob_cleanup==='uncertain')panel.querySelector('p').textContent='一覧からの削除は完了しましたが、保存領域の削除結果は未確認です。同じ削除を再送しません。操作情報を保存して確認してください。';else if(attempt?.acknowledged)panel.querySelector('p').textContent='保存は確認できましたが、表示の更新に失敗しました。操作は繰り返さず、最新を確認してください。入力と保存の参照を保持しています。';([...root.querySelectorAll('dialog[open]')].at(-1)||root).prepend(panel);
 panel.querySelector('[data-inspect]').onclick=async()=>{if(busy||loading||uploadBusy)return;busy=true;status();try{const latest={folders:await read('/folders'),files:await read('/files?all=1')};const pre=panel.querySelector('pre');pre.hidden=false;pre.textContent=JSON.stringify({latest,attempt},null,2);}catch(error){setError(error.message);}finally{busy=false;status();}};
 panel.querySelector('[data-export]').onclick=()=>{const data={attempt,snapshot,queue:uploadItems.map(i=>({name:i.file.name,size:i.file.size,status:i.status,error:i.error})),inputs:[...root.querySelectorAll('input,textarea,select')].filter(e=>e.type!=='file').map(e=>({id:e.id,value:e.value}))};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='works-material-unsaved.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 panel.querySelector('[data-reset]').onclick=async()=>{if(busy||loading||uploadBusy||!confirm('不明な操作は再送せず、未保存の入力・選択ファイルを破棄して読み直しますか？'))return;try{await loadLibrary();if(!alive)return;dialogs.dispose();uploadItems=[];renameTarget=null;renameBase=createBase=null;attempt=null;stopped=false;needsRefresh=false;status();unlock();panel.remove();renderUploadQueue();}catch(error){setError(error.message);}};
 }
const API_BASE = "/api/material-library";
const ACTIVE_TAB_KEY = "works_material_active_tab";

const els = {
  signedIn: root.querySelector("#signed-in"),
  signOut: root.querySelector("#sign-out"),
  userBar: root.querySelector(".user-bar"),
  userAvatar: root.querySelector("#user-avatar"),
  userAvatarFallback: root.querySelector("#user-avatar-fallback"),
  error: root.querySelector("#material-error"),
  tabButtons: root.querySelectorAll("[data-material-tab]"),
  tabPanels: root.querySelectorAll("[data-material-tab-panel]"),
  breadcrumb: root.querySelector("#material-breadcrumb"),
  search: root.querySelector("#material-search-input"),
  folderGrid: root.querySelector("#material-folder-grid"),
  fileList: root.querySelector("#material-file-list"),
  fileCount: root.querySelector("#material-file-count"),
  empty: root.querySelector("#material-empty"),
  newFolder: root.querySelector("#new-folder"),
  newFolderModal: root.querySelector("#new-folder-modal"),
  newFolderClose: root.querySelector("#new-folder-close"),
  newFolderForm: root.querySelector("#new-folder-form"),
  newFolderName: root.querySelector("#new-folder-name"),
  dropzone: root.querySelector("#material-dropzone"),
  fileInput: root.querySelector("#material-file-input"),
  uploadQueue: root.querySelector("#material-upload-queue"),
  uploadStart: root.querySelector("#material-upload-start"),
  uploadDestination: root.querySelector("#material-upload-destination"),
  treeSearch: root.querySelector("#material-tree-search-input"),
  tree: root.querySelector("#material-tree"),
  tags: root.querySelector("#material-tags"),
  tagSearch: root.querySelector("#material-tag-search"),
  tagCount: root.querySelector("#material-tag-count"),
  tagsEmpty: root.querySelector("#material-tags-empty"),
  treeEmpty: root.querySelector("#material-tree-empty"),
  renameModal: root.querySelector("#rename-material-modal"),
  renameTitle: root.querySelector("#rename-material-title"),
  renameClose: root.querySelector("#rename-material-close"),
  renameForm: root.querySelector("#rename-material-form"),
  renameName: root.querySelector("#rename-material-name"),
  codeField: root.querySelector("#material-code-field"),
  code: root.querySelector("#material-code"),
  previewModal: root.querySelector("#material-preview-modal"),
  previewTitle: root.querySelector("#material-preview-title"),
  previewBody: root.querySelector("#material-preview-body"),
  previewClose: root.querySelector("#material-preview-close"),
  previewDownload: root.querySelector("#material-preview-download"),
};

let folders = [];
let files = [];
let currentFolderId = null;
let uploadItems = [];
let treeFiles = [];
let draggedItem = null;
let renameTarget = null;
let previewFile = null;
let previewObjectUrl = null;

function placementButton(type,item){const b=document.createElement('button');b.type='button';b.className='material-icon-btn';b.setAttribute('aria-label',item.name+'の移動・並べ替え');b.innerHTML='<i class="bx bx-move"></i>';b.onclick=()=>openPlacement(type,item);return b;}
function openPlacement(type,item){
 let dialog=root.querySelector('[data-placement]');if(!dialog){dialog=document.createElement('dialog');dialog.className='app-modal';dialog.dataset.placement='';root.append(dialog);}const base=structuredClone(snapshot),kind=type==='folder'?'folders':'files',key=type==='folder'?'parent_id':'folder_id',parent=item[key]||null;
 dialog.innerHTML='<div class="modal-header"><h2>移動・並べ替え</h2><button type="button" data-close-placement class="modal-close" aria-label="閉じる">×</button></div><p data-placement-name></p><form><label>移動先<select name="destination"></select></label><button type="submit">移動</button></form><p>同じ場所の順序（検索で隠れた項目も含みます）</p><button type="button" data-up>上へ</button><button type="button" data-down>下へ</button><p data-placement-error role="alert"></p>';
 dialog.querySelector('[data-placement-name]').textContent=item.name;const select=dialog.querySelector('select'),option=(value,label)=>{const o=document.createElement('option');o.value=value||'';o.textContent=label;select.append(o);};option(null,'すべての教材');
 for(const f of base.folders){const ancestors=folderAncestors(f.id).map(r=>r.id);if(type==='folder'&&(f.id===item.id||ancestors.includes(item.id)))continue;option(f.id,folderPath(f.id));}select.value=parent||'';
 const siblings=base[kind].filter(r=>(r[key]||null)===parent),index=siblings.findIndex(r=>r.id===item.id),up=dialog.querySelector('[data-up]'),down=dialog.querySelector('[data-down]');const controls=()=>{up.disabled=select.value!==(parent||'')||index<=0;down.disabled=select.value!==(parent||'')||index>=siblings.length-1;};select.onchange=controls;controls();
 const apply=async body=>{try{setError();await mutate({op:type+'_update',id:item.id,expected:base,...body});markDialogSaved(dialog);hideDialog(dialog);await loadLibrary();}catch(error){dialog.querySelector('[data-placement-error]').textContent=error.message;setError(error.message);}};
 dialog.querySelector('form').onsubmit=event=>{event.preventDefault();apply({[key]:select.value||null});};up.onclick=()=>{const order=siblings.map(r=>r.id);[order[index],order[index-1]]=[order[index-1],order[index]];apply({order});};down.onclick=()=>{const order=siblings.map(r=>r.id);[order[index],order[index+1]]=[order[index+1],order[index]];apply({order});};dialog.querySelector('[data-close-placement]').onclick=()=>hideDialog(dialog);showDialog(dialog);
}
function setError(message = "") {
  els.error.textContent = message;
}

async function api(path,options={}){
 if(!alive)throw new DOMException('Material module closed','AbortError');
 const method=options.method||'GET';if(method==='GET')return read(path);
 if(!loaded||stopped||busy||needsRefresh)throw Error('処理中または更新を停止しています。');
 const input=options.body?JSON.parse(options.body):{},match=path.match(/^\/(folders|files)\/([^/?]+)$/);
 let body;
 if(path==='/folders'&&method==='POST')body={op:'folder_create',...input,expected:createBase||snapshot};
 else if(match){const kind=match[1]==='folders'?'folder':'file',id=decodeURIComponent(match[2]);body={op:kind+(method==='DELETE'?'_delete':'_update'),id,...input,expected:renameTarget?.id===id&&renameBase?renameBase:snapshot};}
 else if(path==='/file-order')body={op:'file_update',id:input.order[0],folder_id:input.folder_id,order:input.order,expected:snapshot};
 else throw Error('Unsupported material operation');
 return mutate(body);
}
function switchTab(name) {
  const next = ["tree", "tags"].includes(name) ? name : "library";
  try{localStorage.setItem(ACTIVE_TAB_KEY,next);}catch{}
  els.tabButtons.forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.materialTab === next));
  });
  els.tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.materialTabPanel !== next;
  });
  if(next!=="library"&&loaded)loadTreeFiles();
}

function folderById(id) {
  return folders.find((folder) => folder.id === id) || null;
}

function folderAncestors(id) {
  const result = [];
  const visited = new Set();
  let folder = folderById(id);
  while (folder && !visited.has(folder.id)) {
    visited.add(folder.id);
    result.unshift(folder);
    folder = folder.parent_id ? folderById(folder.parent_id) : null;
  }
  return result;
}

function folderPath(id) {
  return folderAncestors(id).map((folder) => folder.name).join(" / ");
}

function escapeText(value) {
  return String(value ?? "");
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  if (value < 1024 * 1024 * 1024) return (value / 1024 / 1024).toFixed(1) + " MB";
  return (value / 1024 / 1024 / 1024).toFixed(1) + " GB";
}

function filePresentation(file) {
  const type = String(file.mime_type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const extension = ((name.match(/\.([a-z0-9]{1,5})$/) || [])[1] || "").toUpperCase();

  if (type.includes("pdf") || extension === "PDF") {
    return { mark: "PDF", tone: "is-pdf", label: "PDF" };
  }
  if (type.includes("word") || ["DOC", "DOCX"].includes(extension)) {
    return { mark: extension || "DOC", tone: "is-word", label: "Word" };
  }
  if (type.includes("sheet") || ["XLS", "XLSX", "CSV"].includes(extension)) {
    return { mark: extension || "XLS", tone: "is-sheet", label: "表計算" };
  }
  if (type.includes("presentation") || ["PPT", "PPTX"].includes(extension)) {
    return { mark: extension || "PPT", tone: "is-slide", label: "スライド" };
  }
  if (type.startsWith("image/") || ["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG", "TIFF", "BMP"].includes(extension)) {
    return { mark: extension === "JPEG" ? "JPG" : (extension || "IMG"), tone: "is-image", label: "画像" };
  }
  if (type.startsWith("video/") || ["MP4", "MOV", "WEBM", "M4V", "AVI", "MPEG"].includes(extension)) {
    return { mark: extension || "VID", tone: "is-video", label: "動画" };
  }
  if (type.startsWith("audio/") || ["MP3", "M4A", "WAV", "AAC", "OGG"].includes(extension)) {
    return { mark: extension || "AUD", tone: "is-audio", label: "音声" };
  }
  if (["ZIP", "RAR", "7Z", "TAR", "GZ"].includes(extension)) {
    return { mark: extension, tone: "is-archive", label: "圧縮" };
  }
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    ["TXT", "MD", "JSON", "XML", "HTML", "CSS", "JS"].includes(extension)
  ) {
    return { mark: extension || "TXT", tone: "is-text", label: "テキスト" };
  }
  return {
    mark: extension && extension.length <= 4 ? extension : "FILE",
    tone: "is-generic",
    label: extension || "ファイル",
  };
}

function fileTypeIconMarkup(file) {
  const presentation = filePresentation(file);
  return '<span class="material-file-icon ' + presentation.tone +
    '" aria-hidden="true"><span class="material-file-mark">' + presentation.mark + "</span></span>";
}

async function moveFileTo(fileId, folderId) {
  const file = files.find((item) => item.id === fileId);
  if (!file || (file.folder_id || null) === (folderId || null)) return;
  await api("/files/" + encodeURIComponent(fileId), {
    method: "PUT",
    body: JSON.stringify({ folder_id: folderId || null }),
  });
}

async function moveFolderTo(folderId, parentId) {
  const folder = folderById(folderId);
  if (!folder || (folder.parent_id || null) === (parentId || null)) return;
  await api("/folders/" + encodeURIComponent(folderId), {
    method: "PUT",
    body: JSON.stringify({ parent_id: parentId || null }),
  });
}

async function reorderFolders(movedId,target,position){
 const parentId=target.parent_id||null,order=folders.filter(f=>(f.parent_id||null)===parentId&&f.id!==movedId).map(f=>f.id);
 order.splice(order.indexOf(target.id)+(position==='after'?1:0),0,movedId);
 await mutate({op:'folder_update',id:movedId,parent_id:parentId,order,expected:snapshot});
}
async function reorderFiles(movedId, targetId, position) {
  if (movedId === targetId) return;
  const order = files.filter((file) => file.id !== movedId).map((file) => file.id);
  const targetIndex = order.indexOf(targetId);
  order.splice(targetIndex + (position === "after" ? 1 : 0), 0, movedId);
  await api("/file-order", {
    method: "PUT",
    body: JSON.stringify({ folder_id: currentFolderId, order }),
  });
}

async function finishDrag(action) {
  try {
    setError();
    await action();
    await loadFiles();
  } catch (err) {
    setError(err.message);
  } finally {
    draggedItem = null;
    clearDropTargets();
  }
}

function clearDropTargets() {
  root.querySelectorAll(".is-drop-target, .is-drop-before, .is-drop-inside, .is-drop-after")
    .forEach((element) => {
      element.classList.remove("is-drop-target", "is-drop-before", "is-drop-inside", "is-drop-after");
    });
}

function dragPosition(element, event) {
  const rect = element.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(rect.height, 1);
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  return "inside";
}

function makeContainerDropTarget(element, folderId) {
  element.addEventListener("dragover", (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropTargets();
    element.classList.add("is-drop-target");
  });
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) clearDropTargets();
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const item = draggedItem;
    if (!item) return;
    finishDrag(() =>
      item.type === "file" ? moveFileTo(item.id, folderId) : moveFolderTo(item.id, folderId)
    );
  });
}

function makeFolderDropTarget(element, folder) {
  element.addEventListener("dragover", (event) => {
    if (!draggedItem || (draggedItem.type === "folder" && draggedItem.id === folder.id)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropTargets();
    const position = draggedItem.type === "folder" ? dragPosition(element, event) : "inside";
    element.classList.add("is-drop-" + position);
  });
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) clearDropTargets();
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const item = draggedItem;
    if (!item || (item.type === "folder" && item.id === folder.id)) return;
    const position = item.type === "folder" ? dragPosition(element, event) : "inside";
    if (item.type === "file") {
      finishDrag(() => moveFileTo(item.id, folder.id));
    } else if (position === "inside") {
      finishDrag(() => moveFolderTo(item.id, folder.id));
    } else {
      finishDrag(() => reorderFolders(item.id, folder, position));
    }
  });
}

function makeFileDropTarget(element, file) {
  element.addEventListener("dragover", (event) => {
    if (!draggedItem || draggedItem.type !== "file" || draggedItem.id === file.id) return;
    event.preventDefault();
    clearDropTargets();
    element.classList.add(event.clientY < element.getBoundingClientRect().top + element.offsetHeight / 2
      ? "is-drop-before" : "is-drop-after");
  });
  element.addEventListener("drop", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedItem || draggedItem.type !== "file" || draggedItem.id === file.id) return;
    const position = event.clientY < element.getBoundingClientRect().top + element.offsetHeight / 2
      ? "before" : "after";
    finishDrag(() => reorderFiles(draggedItem.id, file.id, position));
  });
}

function startDragging(element, type, id, event) {
  draggedItem = { type, id };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", type + ":" + id);
  element.classList.add("is-dragging");
}

function stopDragging(element) {
  draggedItem = null;
  element.classList.remove("is-dragging");
  clearDropTargets();
}

function renderBreadcrumb() {
  els.breadcrumb.replaceChildren();
  const root = document.createElement("button");
  root.type = "button";
  root.className = "material-breadcrumb-btn";
  root.innerHTML = '<i class="bx bx-home"></i><span>すべての教材</span>';
  root.addEventListener("click", () => openFolder(null));
  makeContainerDropTarget(root, null);
  els.breadcrumb.append(root);

  for (const folder of folderAncestors(currentFolderId)) {
    const separator = document.createElement("i");
    separator.className = "bx bx-chevron-right material-breadcrumb-separator";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "material-breadcrumb-btn";
    button.textContent = folder.name;
    button.addEventListener("click", () => openFolder(folder.id));
    makeContainerDropTarget(button, folder.id);
    els.breadcrumb.append(separator, button);
  }
}

function renderFolders() {
  els.folderGrid.replaceChildren();
  const query = els.search.value.trim().toLocaleLowerCase("ja");
  const children = folders.filter((folder) => {
    const sameParent = (folder.parent_id || null) === currentFolderId;
    return sameParent && (!query || folder.name.toLocaleLowerCase("ja").includes(query));
  });

  for (const folder of children) {
    const article = document.createElement("article");
    article.className = "material-folder-card";
    article.draggable = true;
    article.dataset.folderId = folder.id;
    article.addEventListener("dragstart", (event) => startDragging(article, "folder", folder.id, event));
    article.addEventListener("dragend", () => stopDragging(article));
    makeFolderDropTarget(article, folder);

    const handle = document.createElement("span");
    handle.className = "material-drag-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.innerHTML = '<i class="bx bx-move"></i>';

    const open = document.createElement("button");
    open.type = "button";
    open.className = "material-folder-open";
    open.innerHTML =
      '<span class="material-folder-icon"><i class="bx bxs-folder"></i></span>' +
      '<span class="material-folder-copy"><strong></strong><small></small></span>' +
      '<i class="bx bx-chevron-right"></i>';
    open.querySelector("strong").textContent = folder.name;
    const counts = [];
    if (Number(folder.folder_count)) counts.push(folder.folder_count + "フォルダ");
    counts.push((Number(folder.file_count) || 0) + "ファイル");
    open.querySelector("small").textContent = counts.join("・");
    open.addEventListener("click", () => openFolder(folder.id));

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "material-icon-btn";
    rename.setAttribute("aria-label", folder.name + "の名前を変更");
    rename.innerHTML = '<i class="bx bx-pencil"></i>';
    rename.addEventListener("click", () => openRename("folder", folder));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "material-icon-btn";
    remove.setAttribute("aria-label", folder.name + "を削除");
    remove.innerHTML = '<i class="bx bx-trash"></i>';
    remove.addEventListener("click", async () => {
      if (!confirm("「" + folder.name + "」を削除しますか？")) return;
      try {
        setError();
        await api("/folders/" + encodeURIComponent(folder.id), { method: "DELETE" });
        await loadFolders();
      } catch (err) {
        setError(err.message);
      }
    });

    article.append(handle,open,rename,remove,placementButton('folder',folder));
    els.folderGrid.append(article);
  }
}

function matchesMaterialFile(file, query) {
  return !query || [file.name, file.material_code].some(
    (value) => String(value || "").toLocaleLowerCase("ja").includes(query)
  );
}

function renderFiles() {
  els.fileList.replaceChildren();
  const query = els.search.value.trim().toLocaleLowerCase("ja");
  const visible = files.filter(
    (file) => matchesMaterialFile(file, query)
  );
  els.fileCount.textContent = visible.length + "件";
  els.empty.hidden = visible.length > 0 || els.folderGrid.childElementCount > 0;

  for (const file of visible) {
    const item = document.createElement("li");
    item.className = "material-file-item";
    item.draggable = true;
    item.dataset.fileId = file.id;
    item.addEventListener("dragstart", (event) => startDragging(item, "file", file.id, event));
    item.addEventListener("dragend", () => stopDragging(item));
    makeFileDropTarget(item, file);

    const handle = document.createElement("span");
    handle.className = "material-drag-handle";
    handle.setAttribute("aria-hidden", "true");
    handle.innerHTML = '<i class="bx bx-move"></i>';

    const presentation = filePresentation(file);
    const info = document.createElement("div");
    info.className = "material-file-info";
    info.innerHTML =
      fileTypeIconMarkup(file) +
      '<span class="material-file-copy"><strong></strong><small></small></span>';
    info.querySelector("strong").textContent = escapeText(file.name);
    info.querySelector("small").textContent =
      (file.material_code ? "教材コード: " + file.material_code + "・" : "") + presentation.label + "・" + formatSize(file.size) + "・" + String(file.created_at || "").slice(0, 10);

    const actions = document.createElement("div");
    actions.className = "material-file-actions";

    const view = document.createElement("button");
    view.type = "button";
    view.className = "material-icon-btn";
    view.setAttribute("aria-label", file.name + "を閲覧");
    view.innerHTML = '<i class="bx bx-file-find"></i>';
    view.addEventListener("click", () => viewFile(file));

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "material-icon-btn";
    rename.setAttribute("aria-label", file.name + "の名前・教材コードを編集");
    rename.innerHTML = '<i class="bx bx-pencil"></i>';
    rename.addEventListener("click", () => openRename("file", file));

    const download = document.createElement("button");
    download.type = "button";
    download.className = "material-icon-btn";
    download.setAttribute("aria-label", file.name + "をダウンロード");
    download.innerHTML = '<i class="bx bx-download"></i>';
    download.addEventListener("click", () => downloadFile(file));

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "material-icon-btn";
    remove.setAttribute("aria-label", file.name + "を削除");
    remove.innerHTML = '<i class="bx bx-trash"></i>';
    remove.addEventListener("click", () => removeFile(file));

    actions.append(view,rename,download,remove,placementButton('file',file));
    item.append(handle, info, actions);
    els.fileList.append(item);
  }
}

function filesInFolder(folderId) {
  return treeFiles.filter((file) => (file.folder_id || null) === (folderId || null));
}

function treeNodeMatches(folder, query) {
  if (!query) return true;
  if (folder.name.toLocaleLowerCase("ja").includes(query)) return true;
  if (filesInFolder(folder.id).some((file) => matchesMaterialFile(file, query))) return true;
  return folders
    .filter((child) => (child.parent_id || null) === folder.id)
    .some((child) => treeNodeMatches(child, query));
}

function makeTreeFile(file) {
  const presentation = filePresentation(file);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "material-tree-file";
  button.innerHTML =
    fileTypeIconMarkup(file) +
    '<span class="material-tree-file-copy"><strong></strong><small></small></span>' +
    '<i class="bx bx-file-find"></i>';
  button.querySelector("strong").textContent = file.name;
  button.querySelector("small").textContent = (file.material_code ? "教材コード: " + file.material_code + "・" : "") + presentation.label + "・" + formatSize(file.size);
  button.addEventListener("click", () => viewFile(file));
  return button;
}

function makeTreeFolder(folder, query, depth = 0) {
  const details = document.createElement("details");
  details.className = "material-tree-folder";
  details.open = Boolean(query) || depth === 0;

  const summary = document.createElement("summary");
  summary.innerHTML =
    '<span class="material-tree-chevron"><i class="bx bx-chevron-right"></i></span>' +
    '<span class="material-folder-icon"><i class="bx bxs-folder"></i></span>' +
    '<span class="material-tree-folder-copy"><strong></strong><small></small></span>' +
    '<button type="button" class="material-icon-btn" aria-label="このフォルダを開く"><i class="bx bx-folder-open"></i></button>';
  summary.querySelector("strong").textContent = folder.name;
  summary.querySelector("small").textContent =
    Number(folder.folder_count || 0) + "フォルダ・" + Number(folder.file_count || 0) + "ファイル";
  summary.querySelector("button").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    switchTab("library");
    openFolder(folder.id);
  });

  const children = document.createElement("div");
  children.className = "material-tree-children";
  const childFolders = folders.filter(
    (child) => (child.parent_id || null) === folder.id && treeNodeMatches(child, query)
  );
  const childFiles = filesInFolder(folder.id).filter(
    (file) => matchesMaterialFile(file, query) ||
      folder.name.toLocaleLowerCase("ja").includes(query)
  );
  childFolders.forEach((child) => children.append(makeTreeFolder(child, query, depth + 1)));
  childFiles.forEach((file) => children.append(makeTreeFile(file)));
  if (!childFolders.length && !childFiles.length) {
    const empty = document.createElement("span");
    empty.className = "material-tree-branch-empty";
    empty.textContent = "空のフォルダ";
    children.append(empty);
  }
  details.append(summary, children);
  return details;
}

function renderTree() {
  if (!els.tree) return;
  const query = els.treeSearch.value.trim().toLocaleLowerCase("ja");
  els.tree.replaceChildren();
  const root = document.createElement("div");
  root.className = "material-tree-root";
  const rootHeading = document.createElement("div");
  rootHeading.className = "material-tree-root-heading";
  rootHeading.innerHTML = '<i class="bx bx-home"></i><strong>すべての教材</strong>';
  root.append(rootHeading);

  const rootChildren = document.createElement("div");
  rootChildren.className = "material-tree-children";
  const topFolders = folders.filter(
    (folder) => !folder.parent_id && treeNodeMatches(folder, query)
  );
  const rootFiles = filesInFolder(null).filter(
    (file) => matchesMaterialFile(file, query)
  );
  topFolders.forEach((folder) => rootChildren.append(makeTreeFolder(folder, query)));
  rootFiles.forEach((file) => rootChildren.append(makeTreeFile(file)));
  root.append(rootChildren);
  els.tree.append(root);
  els.treeEmpty.hidden = topFolders.length > 0 || rootFiles.length > 0;
}

function groupMaterialTags(allFiles, query = "") {
  const groups = new Map();
  const needle = query.trim().toLocaleLowerCase("ja");
  for (const file of allFiles) {
    const code = String(file.material_code || "").trim();
    if (!code || !matchesMaterialFile(file, needle)) continue;
    const key = code.toLocaleLowerCase("ja");
    if (!groups.has(key)) groups.set(key, { code, files: [] });
    groups.get(key).files.push(file);
  }
  return [...groups.values()]
    .sort((a, b) => a.code.localeCompare(b.code, "en", { sensitivity: "base", numeric: true }))
    .map((group) => ({ ...group, files: group.files.sort((a, b) => a.name.localeCompare(b.name, "ja", { numeric: true })) }));
}

function renderTags() {
  const groups = groupMaterialTags(treeFiles, els.tagSearch.value);
  els.tags.replaceChildren();
  els.tagCount.textContent = groups.length + "タグ";
  els.tagsEmpty.hidden = groups.length > 0;
  for (const group of groups) {
    const section = document.createElement("section");
    const heading = document.createElement("h3");
    heading.className = "material-tree-root-heading";
    heading.textContent = group.code + "（" + group.files.length + "件）";
    section.append(heading);
    for (const file of group.files) {
      const button = makeTreeFile(file);
      button.querySelector("small").textContent = folderPath(file.folder_id) || "すべての教材";
      section.append(button);
    }
    els.tags.append(section);
  }
}

async function loadTreeFiles(){renderTree();renderTags();}
function renderLibrary() {
  renderBreadcrumb();
  renderFolders();
  renderFiles();
  if (els.uploadDestination) {
    els.uploadDestination.textContent = currentFolderId ? folderPath(currentFolderId) : "すべての教材";
  }
  if (!els.tabPanels[1].hidden) renderTree();
}

async function loadFolders(){await loadLibrary();}
async function loadFiles(){await loadLibrary();}
async function loadLibrary(){
 loading=true;status();
 try{const next={folders:await read('/folders'),files:await read('/files?all=1')};validateMaterialListing(next);if(!alive)return;snapshot=next;folders=next.folders;treeFiles=next.files;if(currentFolderId&&!folderById(currentFolderId))currentFolderId=null;files=treeFiles.filter(f=>(f.folder_id||null)===currentFolderId);loaded=true;needsRefresh=false;setError();els.signedIn.hidden=false;renderLibrary();renderTree();renderTags();}
 catch(error){if(alive){stopped=true;recovery();}throw error;}finally{loading=false;status();if(!stopped)unlock();}
}
async function openFolder(id){if(!canNavigate())return;const destination=id?'/material/folders/'+encodeURIComponent(id)+'/':'/material/';navigate(destination);}
function openRename(type, item) {
  renameTarget = { type, id: item.id };renameBase=structuredClone(snapshot);
  els.renameTitle.textContent = type === "folder" ? "フォルダ名を変更" : "教材情報を編集";
  els.renameName.maxLength = type === "folder" ? 120 : 255;
  els.renameName.value = item.name;
  els.codeField.hidden = type !== "file";
  els.code.disabled = type !== "file";
  els.code.value = type === "file" ? item.material_code || "" : "";
  showDialog(els.renameModal);
  requestAnimationFrame(() => {
    els.renameName.focus();
    els.renameName.select();
  });
}

function cleanupPreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
  previewFile = null;
  els.previewBody.replaceChildren();
}

function isTextPreview(file) {
  const type = String(file.mime_type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  return (
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("xml") ||
    /\.(txt|md|csv|json|xml|html|css|js)$/.test(name)
  );
}

async function viewFile(file){
 const generation=++previewGeneration;cleanupPreview();previewFile=file;els.previewTitle.textContent=file.name;els.previewBody.textContent='読み込み中…';showDialog(els.previewModal);
 try{const blob=await context.request(API_BASE+'/files/'+encodeURIComponent(file.id)+'/view',{responseType:'blob',signal:lifecycle.signal});if(!alive||generation!==previewGeneration||!els.previewModal.open)return;els.previewBody.replaceChildren();const type=String(file.mime_type||blob.type||'').toLowerCase();
 if(isTextPreview(file)){const pre=document.createElement('pre');pre.className='material-text-preview';pre.textContent=await blob.text();if(alive&&generation===previewGeneration&&els.previewModal.open)els.previewBody.append(pre);return;}
 let el;if(type.startsWith('image/')){el=document.createElement('img');el.alt=file.name;el.className='material-image-preview';}else if(type.startsWith('video/')||type.startsWith('audio/')){el=document.createElement(type.startsWith('video/')?'video':'audio');el.controls=true;el.className='material-media-preview';}else if(type.includes('pdf')||file.name.toLowerCase().endsWith('.pdf')){el=document.createElement('iframe');el.title=file.name;el.className='material-pdf-preview';}else{els.previewBody.textContent='この形式はブラウザ内で表示できません。ダウンロードして内容を確認してください。';return;}
 previewObjectUrl=URL.createObjectURL(blob);el.src=previewObjectUrl;els.previewBody.append(el);
 }catch(error){if(alive&&generation===previewGeneration){els.previewBody.textContent=error.message;setError(error.message);}}
}
async function downloadFile(file){try{const blob=await context.request(API_BASE+'/files/'+encodeURIComponent(file.id)+'/download',{responseType:'blob',signal:lifecycle.signal});if(!alive)return;const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){if(alive)setError(error.message);}}
async function removeFile(file) {
  if (!confirm("「" + file.name + "」を削除しますか？")) return;
  try {
    setError();
    await api("/files/" + encodeURIComponent(file.id), { method: "DELETE" });
    await loadFiles();
  } catch (err) {
    setError(err.message);
  }
}

function addUploadFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    const duplicate = uploadItems.some(
      (item) =>
        item.file.name === file.name &&
        item.file.size === file.size &&
        item.file.lastModified === file.lastModified
    );
    if (!duplicate) uploadItems.push({ file, status: "pending", progress: 0, error: "" });
  }
  renderUploadQueue();
}

function renderUploadQueue() {
  els.uploadQueue.replaceChildren();
  for (const [index, item] of uploadItems.entries()) {
    const li = document.createElement("li");
    li.className = "material-upload-item";
    li.innerHTML =
      '<div class="material-upload-item-row">' +
      fileTypeIconMarkup(item.file) +
      '<span class="material-upload-copy"><strong></strong><small></small></span>' +
      '<button type="button" class="material-icon-btn" aria-label="選択から外す"><i class="bx bx-x"></i></button>' +
      "</div>" +
      '<div class="material-progress"><span></span></div>';
    li.querySelector("strong").textContent = item.file.name;
    const statusText =
      item.status === "uploading"
        ? item.progress + "%"
        : item.status === "done"
          ? "完了"
          : item.status === "error"
            ? item.error
            : formatSize(item.file.size);
    li.querySelector("small").textContent = statusText;
    li.querySelector(".material-progress span").style.width = item.progress + "%";
    li.classList.toggle("is-done", item.status === "done");
    li.classList.toggle("is-error", item.status === "error");
    const remove = li.querySelector("button");
    remove.disabled = item.status === "uploading";
    remove.addEventListener("click", () => {
      uploadItems.splice(index, 1);
      renderUploadQueue();
    });
    els.uploadQueue.append(li);
  }
  els.uploadStart.disabled = stopped||uploadBusy||
    uploadItems.length === 0 || !uploadItems.some((item) => item.status !== "done");
}

async function uploadAll(){
 if(uploadBusy||busy||loading||stopped||!loaded)return;const folderId=currentFolderId;uploadBusy=true;status();setError();
 try{for(const item of uploadItems){if(item.status==='done')continue;item.status='uploading';item.error='';item.progress=0;renderUploadQueue();
 let receipt=null;try{const row=await context.uploadMaterial(item.file,folderId,{signal:lifecycle.signal,onProgress:p=>{if(alive){item.progress=p;renderUploadQueue();}}});if(!alive)return;
 assertMaterialUpload(item.file,folderId,row);receipt=row;
 item.status='done';item.progress=100;attempt={upload:{name:item.file.name,size:item.file.size,type:item.file.type,folder_id:folderId},acknowledged:true,result:row};needsRefresh=true;await loadLibrary();
 }catch(error){if(!alive)return;item.status=receipt?'done':'error';item.error=error.message;stopped=true;attempt={upload:{name:item.file.name,size:item.file.size,type:item.file.type,folder_id:folderId},acknowledged:!!receipt,...(receipt?{result:receipt}:{}),...(error.material_operation?{material_operation:error.material_operation}:{})};recovery();renderUploadQueue();break;}
 renderUploadQueue();}
 if(!stopped){uploadItems=uploadItems.filter(item=>item.status!=='done');attempt=null;renderUploadQueue();}
 }finally{uploadBusy=false;status();if(alive)renderUploadQueue();}
}
els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.materialTab));
});
els.search.addEventListener("input", renderLibrary);
els.tagSearch.addEventListener("input", renderTags);
els.treeSearch.addEventListener("input", renderTree);
els.newFolder.addEventListener("click", () => {
  createBase=structuredClone(snapshot);els.newFolderName.value = "";
  showDialog(els.newFolderModal);
  requestAnimationFrame(() => els.newFolderName.focus());
});
els.newFolderClose.addEventListener("click", () => hideDialog(els.newFolderModal));
els.renameClose.addEventListener("click", () => hideDialog(els.renameModal));
els.renameModal.addEventListener("close",()=>{renameTarget=null;renameBase=null;});
els.renameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!renameTarget) return;
  try {
    setError();
    const path =
      renameTarget.type === "folder"
        ? "/folders/" + encodeURIComponent(renameTarget.id)
        : "/files/" + encodeURIComponent(renameTarget.id);
    await api(path, {
      method: "PUT",
      body: JSON.stringify({
        name: els.renameName.value,
        ...(renameTarget.type === "file" ? { material_code: els.code.value } : {}),
      }),
    });
    markDialogSaved(els.renameModal);hideDialog(els.renameModal);
    renameTarget = null;
    await loadFiles();
  } catch (err) {
    setError(err.message);
  }
});
els.previewClose.addEventListener("click", () => hideDialog(els.previewModal));
els.previewModal.addEventListener("close",()=>{previewGeneration++;cleanupPreview();});
els.previewDownload.addEventListener("click", () => {
  if (previewFile) downloadFile(previewFile);
});
els.newFolderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setError();
    await api("/folders", {
      method: "POST",
      body: JSON.stringify({
        name: els.newFolderName.value,
        parent_id: currentFolderId,
      }),
    });
    markDialogSaved(els.newFolderModal);hideDialog(els.newFolderModal);
    await loadFolders();
  } catch (err) {
    setError(err.message);
  }
});
els.fileInput.addEventListener("change", () => {
  addUploadFiles(els.fileInput.files);
  els.fileInput.value = "";
});
["dragenter", "dragover"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.add("is-dragging");
  });
});
["dragleave", "drop"].forEach((name) => {
  els.dropzone.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropzone.classList.remove("is-dragging");
  });
});
els.dropzone.addEventListener("drop", (event) => addUploadFiles(event.dataTransfer.files));
els.uploadStart.addEventListener("click", uploadAll);

try{switchTab(localStorage.getItem(ACTIVE_TAB_KEY)||'library');}catch{switchTab('library');}
currentFolderId=type==='folders'?id:null;
loadLibrary().then(()=>{if(alive&&type==='files'&&id){const file=treeFiles.find(f=>f.id===id);if(file){currentFolderId=file.folder_id||null;files=treeFiles.filter(f=>(f.folder_id||null)===currentFolderId);renderLibrary();viewFile(file);}else setError('対象の教材が見つかりません。');}}).catch(error=>setError(error.message));
return {get dirty(){return busy||loading||uploadBusy||stopped||dialogs.dirty()||uploadItems.length>0;},beforeHistoryLeave(){const d=[...root.querySelectorAll('dialog[open]')].at(-1);if(d){if(!busy&&!loading&&!uploadBusy&&!stopped)hideDialog(d);return false;}return true;},canLeave:canNavigate,unmount(){alive=false;icons.disconnect();lifecycle.abort();dialogs.dispose();cleanupPreview();folders=files=treeFiles=uploadItems=[];snapshot=attempt=null;root.replaceChildren();context.metrics.unmounts++;}};
}
