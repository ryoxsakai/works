import {
  watchAuth,
  signOutUser,
  getSessionToken,
} from "../shared/auth.js?v=11";

const API_BASE = "/api/material-library";
const ACTIVE_TAB_KEY = "works_material_active_tab";

const els = {
  signedIn: document.querySelector("#signed-in"),
  signOut: document.querySelector("#sign-out"),
  userBar: document.querySelector(".user-bar"),
  userAvatar: document.querySelector("#user-avatar"),
  userAvatarFallback: document.querySelector("#user-avatar-fallback"),
  error: document.querySelector("#material-error"),
  tabButtons: document.querySelectorAll("[data-material-tab]"),
  tabPanels: document.querySelectorAll("[data-material-tab-panel]"),
  breadcrumb: document.querySelector("#material-breadcrumb"),
  search: document.querySelector("#material-search-input"),
  folderGrid: document.querySelector("#material-folder-grid"),
  fileList: document.querySelector("#material-file-list"),
  fileCount: document.querySelector("#material-file-count"),
  empty: document.querySelector("#material-empty"),
  newFolder: document.querySelector("#new-folder"),
  newFolderModal: document.querySelector("#new-folder-modal"),
  newFolderClose: document.querySelector("#new-folder-close"),
  newFolderForm: document.querySelector("#new-folder-form"),
  newFolderName: document.querySelector("#new-folder-name"),
  dropzone: document.querySelector("#material-dropzone"),
  fileInput: document.querySelector("#material-file-input"),
  uploadQueue: document.querySelector("#material-upload-queue"),
  uploadStart: document.querySelector("#material-upload-start"),
  uploadDestination: document.querySelector("#material-upload-destination"),
  treeSearch: document.querySelector("#material-tree-search-input"),
  tree: document.querySelector("#material-tree"),
  treeEmpty: document.querySelector("#material-tree-empty"),
  renameModal: document.querySelector("#rename-material-modal"),
  renameTitle: document.querySelector("#rename-material-title"),
  renameClose: document.querySelector("#rename-material-close"),
  renameForm: document.querySelector("#rename-material-form"),
  renameName: document.querySelector("#rename-material-name"),
  previewModal: document.querySelector("#material-preview-modal"),
  previewTitle: document.querySelector("#material-preview-title"),
  previewBody: document.querySelector("#material-preview-body"),
  previewClose: document.querySelector("#material-preview-close"),
  previewDownload: document.querySelector("#material-preview-download"),
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

function setError(message = "") {
  els.error.textContent = message;
}

async function api(path, options = {}) {
  const token = getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", "Bearer " + token);
  if (options.body && !(options.body instanceof Blob) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(API_BASE + path, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "通信に失敗しました (" + res.status + ")");
  }
  if (res.status === 204) return null;
  return res.json();
}

function switchTab(name) {
  const next = name === "tree" ? "tree" : "library";
  localStorage.setItem(ACTIVE_TAB_KEY, next);
  els.tabButtons.forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.materialTab === next));
  });
  els.tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.materialTabPanel !== next;
  });
  if (next === "tree" && getSessionToken()) loadTreeFiles();
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

async function reorderFolders(movedId, target, position) {
  const parentId = target.parent_id || null;
  await moveFolderTo(movedId, parentId);
  folders = await api("/folders");
  const order = folders
    .filter((folder) => (folder.parent_id || null) === parentId && folder.id !== movedId)
    .map((folder) => folder.id);
  const targetIndex = order.indexOf(target.id);
  order.splice(targetIndex + (position === "after" ? 1 : 0), 0, movedId);
  await api("/folder-order", {
    method: "PUT",
    body: JSON.stringify({ parent_id: parentId, order }),
  });
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
    folders = await api("/folders");
    await loadFiles();
  } catch (err) {
    setError(err.message);
  } finally {
    draggedItem = null;
    clearDropTargets();
  }
}

function clearDropTargets() {
  document.querySelectorAll(".is-drop-target, .is-drop-before, .is-drop-inside, .is-drop-after")
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

    article.append(handle, open, rename, remove);
    els.folderGrid.append(article);
  }
}

function renderFiles() {
  els.fileList.replaceChildren();
  const query = els.search.value.trim().toLocaleLowerCase("ja");
  const visible = files.filter(
    (file) => !query || file.name.toLocaleLowerCase("ja").includes(query)
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
      presentation.label + "・" + formatSize(file.size) + "・" + String(file.created_at || "").slice(0, 10);

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
    rename.setAttribute("aria-label", file.name + "の名前を変更");
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

    actions.append(view, rename, download, remove);
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
  if (filesInFolder(folder.id).some((file) => file.name.toLocaleLowerCase("ja").includes(query))) return true;
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
  button.querySelector("small").textContent = presentation.label + "・" + formatSize(file.size);
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
    (file) => !query || file.name.toLocaleLowerCase("ja").includes(query) ||
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
    (file) => !query || file.name.toLocaleLowerCase("ja").includes(query)
  );
  topFolders.forEach((folder) => rootChildren.append(makeTreeFolder(folder, query)));
  rootFiles.forEach((file) => rootChildren.append(makeTreeFile(file)));
  root.append(rootChildren);
  els.tree.append(root);
  els.treeEmpty.hidden = topFolders.length > 0 || rootFiles.length > 0;
}

async function loadTreeFiles() {
  try {
    setError();
    treeFiles = await api("/files?all=1");
    renderTree();
  } catch (err) {
    setError(err.message);
  }
}

function renderLibrary() {
  renderBreadcrumb();
  renderFolders();
  renderFiles();
  if (els.uploadDestination) {
    els.uploadDestination.textContent = currentFolderId ? folderPath(currentFolderId) : "すべての教材";
  }
  if (!els.tabPanels[1].hidden) renderTree();
}

async function loadFolders() {
  folders = await api("/folders");
  if (currentFolderId && !folderById(currentFolderId)) currentFolderId = null;
  renderLibrary();
}

async function loadFiles() {
  const query = currentFolderId ? "?folder_id=" + encodeURIComponent(currentFolderId) : "";
  files = await api("/files" + query);
  renderLibrary();
}

async function loadLibrary() {
  setError();
  try {
    folders = await api("/folders");
    await loadFiles();
  } catch (err) {
    setError(err.message);
  }
}

async function openFolder(id) {
  currentFolderId = id || null;
  els.search.value = "";
  await loadFiles();
}

function openRename(type, item) {
  renameTarget = { type, id: item.id };
  els.renameTitle.textContent = type === "folder" ? "フォルダ名を変更" : "ファイル名を変更";
  els.renameName.maxLength = type === "folder" ? 120 : 255;
  els.renameName.value = item.name;
  els.renameModal.showModal();
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

async function fetchFileResponse(file, action) {
  const res = await fetch(
    API_BASE + "/files/" + encodeURIComponent(file.id) + "/" + action,
    { headers: { Authorization: "Bearer " + getSessionToken() } }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "ファイルの取得に失敗しました");
  }
  return res;
}

async function viewFile(file) {
  try {
    setError();
    cleanupPreview();
    previewFile = file;
    els.previewTitle.textContent = file.name;
    els.previewBody.innerHTML =
      '<div class="material-preview-loading"><i class="bx bx-loader-alt bx-spin"></i> 読み込み中</div>';
    els.previewModal.showModal();

    const res = await fetchFileResponse(file, "view");
    const blob = await res.blob();
    const type = String(file.mime_type || blob.type || "").toLowerCase();
    els.previewBody.replaceChildren();

    if (isTextPreview(file)) {
      const pre = document.createElement("pre");
      pre.className = "material-text-preview";
      pre.textContent = await blob.text();
      els.previewBody.append(pre);
      return;
    }

    previewObjectUrl = URL.createObjectURL(blob);
    if (type.startsWith("image/")) {
      const image = document.createElement("img");
      image.className = "material-image-preview";
      image.src = previewObjectUrl;
      image.alt = file.name;
      els.previewBody.append(image);
      return;
    }
    if (type.startsWith("video/")) {
      const video = document.createElement("video");
      video.className = "material-media-preview";
      video.src = previewObjectUrl;
      video.controls = true;
      els.previewBody.append(video);
      return;
    }
    if (type.startsWith("audio/")) {
      const audio = document.createElement("audio");
      audio.className = "material-audio-preview";
      audio.src = previewObjectUrl;
      audio.controls = true;
      els.previewBody.append(audio);
      return;
    }
    if (type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf")) {
      const frame = document.createElement("iframe");
      frame.className = "material-pdf-preview";
      frame.src = previewObjectUrl;
      frame.title = file.name;
      els.previewBody.append(frame);
      return;
    }

    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
    const unsupported = document.createElement("div");
    unsupported.className = "material-preview-unsupported";
    unsupported.innerHTML =
      '<i class="bx bx-file-blank"></i><p>この形式はブラウザ内で表示できません。</p>' +
      "<small>ダウンロードして内容を確認してください。</small>";
    els.previewBody.append(unsupported);
  } catch (err) {
    els.previewBody.replaceChildren();
    setError(err.message);
    if (els.previewModal.open) els.previewModal.close();
  }
}

async function downloadFile(file) {
  try {
    setError();
    const res = await fetch(
      API_BASE + "/files/" + encodeURIComponent(file.id) + "/download",
      { headers: { Authorization: "Bearer " + getSessionToken() } }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "ダウンロードに失敗しました");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    setError(err.message);
  }
}

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
  els.uploadStart.disabled =
    uploadItems.length === 0 || !uploadItems.some((item) => item.status !== "done");
}

function uploadOne(item, folderId) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      name: item.file.name,
      size: String(item.file.size),
    });
    if (folderId) params.set("folder_id", folderId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", API_BASE + "/files?" + params);
    xhr.setRequestHeader("Authorization", "Bearer " + getSessionToken());
    xhr.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      item.progress = Math.round((event.loaded / event.total) * 100);
      renderUploadQueue();
    });
    xhr.addEventListener("load", () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText || "{}");
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || "アップロードに失敗しました (" + xhr.status + ")"));
    });
    xhr.addEventListener("error", () => reject(new Error("アップロード中に通信エラーが発生しました")));
    xhr.send(item.file);
  });
}

async function uploadAll() {
  const folderId = currentFolderId || null;
  els.uploadStart.disabled = true;
  setError();
  let completed = 0;

  for (const item of uploadItems) {
    if (item.status === "done") continue;
    item.status = "uploading";
    item.progress = 0;
    item.error = "";
    renderUploadQueue();
    try {
      await uploadOne(item, folderId);
      item.status = "done";
      item.progress = 100;
      completed += 1;
    } catch (err) {
      item.status = "error";
      item.error = err.message;
    }
    renderUploadQueue();
  }

  if (completed > 0) {
    uploadItems = uploadItems.filter((item) => item.status !== "done");
    renderUploadQueue();
    await loadLibrary();
    if (!els.tabPanels[1].hidden) await loadTreeFiles();
  }
}

els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.materialTab));
});
els.search.addEventListener("input", renderLibrary);
els.treeSearch.addEventListener("input", renderTree);
els.newFolder.addEventListener("click", () => {
  els.newFolderName.value = "";
  els.newFolderModal.showModal();
  requestAnimationFrame(() => els.newFolderName.focus());
});
els.newFolderClose.addEventListener("click", () => els.newFolderModal.close());
els.renameClose.addEventListener("click", () => els.renameModal.close());
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
      body: JSON.stringify({ name: els.renameName.value }),
    });
    els.renameModal.close();
    renameTarget = null;
    folders = await api("/folders");
    await loadFiles();
  } catch (err) {
    setError(err.message);
  }
});
els.previewClose.addEventListener("click", () => els.previewModal.close());
els.previewModal.addEventListener("close", cleanupPreview);
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
    els.newFolderModal.close();
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
els.signOut.addEventListener("click", async () => {
  await signOutUser();
  window.location.assign("/");
});

switchTab(localStorage.getItem(ACTIVE_TAB_KEY) || "library");

watchAuth({
  onSignedIn: async ({ email, picture }) => {
    els.signedIn.hidden = false;
    els.userBar.hidden = false;
    els.signOut.title = `${email} (クリックでログアウト)`;
    if (picture) {
      els.userAvatar.src = picture;
      els.userAvatar.hidden = false;
      els.userAvatarFallback.hidden = true;
    } else {
      els.userAvatar.hidden = true;
      els.userAvatarFallback.hidden = false;
    }
    await loadLibrary();
    if (!els.tabPanels[1].hidden) await loadTreeFiles();
  },
  onSignedOut: () => {
    window.location.replace("/");
  },
});
