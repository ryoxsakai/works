import {
  watchAuth,
  signIn,
  signOutUser,
  getSessionToken,
} from "../shared/auth.js?v=11";

const API_BASE = "/api/material-library";
const ACTIVE_TAB_KEY = "works_material_active_tab";

const els = {
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  signIn: document.querySelector("#sign-in"),
  signOut: document.querySelector("#sign-out"),
  userBar: document.querySelector(".user-bar"),
  userAvatar: document.querySelector("#user-avatar"),
  userAvatarFallback: document.querySelector("#user-avatar-fallback"),
  authError: document.querySelector("#auth-error"),
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
  uploadFolder: document.querySelector("#upload-folder-select"),
  dropzone: document.querySelector("#material-dropzone"),
  fileInput: document.querySelector("#material-file-input"),
  uploadQueue: document.querySelector("#material-upload-queue"),
  uploadStart: document.querySelector("#material-upload-start"),
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
let draggedFileId = null;
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
  const next = name === "upload" ? "upload" : "library";
  localStorage.setItem(ACTIVE_TAB_KEY, next);
  els.tabButtons.forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.materialTab === next));
  });
  els.tabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.materialTabPanel !== next;
  });
  if (next === "upload") {
    els.uploadFolder.value = currentFolderId || "";
  }
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
  if (type.includes("pdf") || name.endsWith(".pdf")) {
    return { icon: "bx-file-pdf", tone: "is-pdf", label: "PDF" };
  }
  if (type.includes("word") || /\.(doc|docx)$/.test(name)) {
    return { icon: "bx-file", tone: "is-word", label: "Word" };
  }
  if (type.includes("sheet") || /\.(xls|xlsx|csv)$/.test(name)) {
    return { icon: "bx-spreadsheet", tone: "is-sheet", label: "表計算" };
  }
  if (type.includes("presentation") || /\.(ppt|pptx)$/.test(name)) {
    return { icon: "bx-slideshow", tone: "is-slide", label: "スライド" };
  }
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(name)) {
    return { icon: "bx-image", tone: "is-image", label: "画像" };
  }
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/.test(name)) {
    return { icon: "bx-video", tone: "is-video", label: "動画" };
  }
  if (type.startsWith("audio/") || /\.(mp3|m4a|wav|aac|ogg)$/.test(name)) {
    return { icon: "bx-music", tone: "is-audio", label: "音声" };
  }
  if (/\.(zip|rar|7z|tar|gz)$/.test(name)) {
    return { icon: "bx-archive", tone: "is-archive", label: "圧縮" };
  }
  if (
    type.startsWith("text/") ||
    type.includes("json") ||
    /\.(txt|md|json|xml|html|css|js)$/.test(name)
  ) {
    return { icon: "bx-file-blank", tone: "is-text", label: "テキスト" };
  }
  return { icon: "bx-file-blank", tone: "is-generic", label: "ファイル" };
}

async function moveFileTo(fileId, folderId) {
  const file = files.find((item) => item.id === fileId);
  if (!file || (file.folder_id || null) === (folderId || null)) return;
  try {
    setError();
    await api("/files/" + encodeURIComponent(fileId), {
      method: "PUT",
      body: JSON.stringify({ folder_id: folderId || null }),
    });
    folders = await api("/folders");
    await loadFiles();
  } catch (err) {
    setError(err.message);
  }
}

function clearDropTargets() {
  document.querySelectorAll(".is-drop-target").forEach((element) => {
    element.classList.remove("is-drop-target");
  });
}

function makeFolderDropTarget(element, folderId) {
  element.addEventListener("dragover", (event) => {
    if (!draggedFileId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    clearDropTargets();
    element.classList.add("is-drop-target");
  });
  element.addEventListener("dragleave", (event) => {
    if (!element.contains(event.relatedTarget)) element.classList.remove("is-drop-target");
  });
  element.addEventListener("drop", async (event) => {
    event.preventDefault();
    const fileId = draggedFileId || event.dataTransfer.getData("text/plain");
    clearDropTargets();
    draggedFileId = null;
    if (fileId) await moveFileTo(fileId, folderId);
  });
}

function renderBreadcrumb() {
  els.breadcrumb.replaceChildren();
  const root = document.createElement("button");
  root.type = "button";
  root.className = "material-breadcrumb-btn";
  root.innerHTML = '<i class="bx bx-home"></i><span>すべての教材</span>';
  root.addEventListener("click", () => openFolder(null));
  makeFolderDropTarget(root, null);
  els.breadcrumb.append(root);

  for (const folder of folderAncestors(currentFolderId)) {
    const separator = document.createElement("i");
    separator.className = "bx bx-chevron-right material-breadcrumb-separator";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "material-breadcrumb-btn";
    button.textContent = folder.name;
    button.addEventListener("click", () => openFolder(folder.id));
    makeFolderDropTarget(button, folder.id);
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
    makeFolderDropTarget(article, folder.id);

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

    article.append(open, rename, remove);
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
    item.addEventListener("dragstart", (event) => {
      draggedFileId = file.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", file.id);
      item.classList.add("is-dragging");
    });
    item.addEventListener("dragend", () => {
      draggedFileId = null;
      item.classList.remove("is-dragging");
      clearDropTargets();
    });

    const presentation = filePresentation(file);
    const info = document.createElement("div");
    info.className = "material-file-info";
    info.innerHTML =
      '<span class="material-file-icon ' + presentation.tone + '"><i class="bx ' +
      presentation.icon +
      '"></i></span>' +
      '<span class="material-file-copy"><strong></strong><small></small></span>';
    info.querySelector("strong").textContent = escapeText(file.name);
    info.querySelector("small").textContent =
      formatSize(file.size) + "・" + String(file.created_at || "").slice(0, 10);

    const actions = document.createElement("div");
    actions.className = "material-file-actions";

    const view = document.createElement("button");
    view.type = "button";
    view.className = "material-icon-btn";
    view.setAttribute("aria-label", file.name + "を閲覧");
    view.innerHTML = '<i class="bx bx-show"></i>';
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
    item.append(info, actions);
    els.fileList.append(item);
  }
}

function renderFolderSelect() {
  const selected = els.uploadFolder.value || currentFolderId || "";
  els.uploadFolder.replaceChildren(new Option("すべての教材", ""));
  const sorted = [...folders].sort((a, b) =>
    folderPath(a.id).localeCompare(folderPath(b.id), "ja")
  );
  for (const folder of sorted) {
    els.uploadFolder.add(new Option(folderPath(folder.id), folder.id));
  }
  els.uploadFolder.value = sorted.some((folder) => folder.id === selected) ? selected : "";
}

function renderLibrary() {
  renderBreadcrumb();
  renderFolders();
  renderFiles();
  renderFolderSelect();
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
      '<span class="material-file-icon ' +
      filePresentation(item.file).tone +
      '"><i class="bx ' +
      filePresentation(item.file).icon +
      '"></i></span>' +
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
  const folderId = els.uploadFolder.value || null;
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
    currentFolderId = folderId;
    await loadLibrary();
  }
}

els.tabButtons.forEach((button) => {
  button.addEventListener("click", () => switchTab(button.dataset.materialTab));
});
els.search.addEventListener("input", renderLibrary);
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
els.signIn.addEventListener("click", signIn);
els.signOut.addEventListener("click", async () => {
  await signOutUser();
  els.signedIn.hidden = true;
  els.signedOut.hidden = false;
  els.userBar.hidden = true;
});

switchTab(localStorage.getItem(ACTIVE_TAB_KEY) || "library");

watchAuth({
  onSignedIn: async ({ picture }) => {
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;
    els.userBar.hidden = false;
    els.authError.textContent = "";
    if (picture) {
      els.userAvatar.src = picture;
      els.userAvatar.hidden = false;
      els.userAvatarFallback.hidden = true;
    }
    await loadLibrary();
  },
  onSignedOut: (message) => {
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    els.userBar.hidden = true;
    els.authError.textContent = message || "";
  },
});
