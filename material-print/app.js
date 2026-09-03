import {
  watchAuth,
  signOutUser,
  getSessionToken,
} from "../shared/auth.js?v=11";
import {
  parseWeeklyTestDraft,
  createPrintDocumentHtml,
} from "./print-template.mjs?v=2";

const API_BASE = "/api/material-library";

const els = {
  signedIn: document.querySelector("#signed-in"),
  signOut: document.querySelector("#sign-out"),
  userBar: document.querySelector(".user-bar"),
  userAvatar: document.querySelector("#user-avatar"),
  userAvatarFallback: document.querySelector("#user-avatar-fallback"),
  error: document.querySelector("#print-error"),
  breadcrumb: document.querySelector("#print-breadcrumb"),
  search: document.querySelector("#print-search-input"),
  folderGrid: document.querySelector("#print-folder-grid"),
  fileList: document.querySelector("#print-file-list"),
  fileCount: document.querySelector("#print-file-count"),
  empty: document.querySelector("#print-empty"),
  localFile: document.querySelector("#print-local-file"),
  selectedPath: document.querySelector("#print-selected-path"),
  action: document.querySelector("#print-action"),
  status: document.querySelector("#print-status"),
  previewEmpty: document.querySelector("#print-preview-empty"),
  previewFrame: document.querySelector("#print-preview-frame"),
};

let folders = [];
let files = [];
let currentFolderId = null;
let selectedKey = null;
let previewGeneration = 0;

function setError(message = "") {
  els.error.textContent = message;
}

function setStatus(message, type = "info") {
  const icon = type === "error" ? "bx-error-circle" : type === "ready" ? "bx-check-circle" : "bx-info-circle";
  els.status.className = `print-status${type === "ready" ? " is-ready" : type === "error" ? " is-error" : ""}`;
  els.status.innerHTML = `<i class="bx ${icon}"></i><span></span>`;
  els.status.querySelector("span").textContent = message;
}

async function api(path) {
  const token = getSessionToken();
  const res = await fetch(API_BASE + path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `通信に失敗しました (${res.status})`);
  }
  return res.json();
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

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isPrintableDraft(file) {
  const name = String(file.name || "");
  const type = String(file.mime_type || "").toLowerCase();
  return /\.txt$/i.test(name) && (type === "" || type.startsWith("text/") || type === "application/octet-stream");
}

function renderBreadcrumb() {
  els.breadcrumb.replaceChildren();
  const root = document.createElement("button");
  root.type = "button";
  root.className = "material-breadcrumb-btn";
  root.innerHTML = '<i class="bx bx-home"></i><span>すべての教材</span>';
  root.addEventListener("click", () => openFolder(null));
  els.breadcrumb.append(root);

  for (const folder of folderAncestors(currentFolderId)) {
    const separator = document.createElement("i");
    separator.className = "bx bx-chevron-right material-breadcrumb-separator";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "material-breadcrumb-btn";
    button.textContent = folder.name;
    button.addEventListener("click", () => openFolder(folder.id));
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
    const open = document.createElement("button");
    open.type = "button";
    open.className = "material-folder-open";
    open.innerHTML =
      '<span class="material-folder-icon"><i class="bx bxs-folder"></i></span>' +
      '<span class="material-folder-copy"><strong></strong><small></small></span>' +
      '<i class="bx bx-chevron-right"></i>';
    open.querySelector("strong").textContent = folder.name;
    const counts = [];
    if (Number(folder.folder_count)) counts.push(`${folder.folder_count}フォルダ`);
    counts.push(`${Number(folder.file_count) || 0}ファイル`);
    open.querySelector("small").textContent = counts.join("・");
    open.addEventListener("click", () => openFolder(folder.id));
    article.append(open);
    els.folderGrid.append(article);
  }
}

function renderFiles() {
  els.fileList.replaceChildren();
  const query = els.search.value.trim().toLocaleLowerCase("ja");
  const visible = files.filter((file) => {
    return isPrintableDraft(file) && (!query || file.name.toLocaleLowerCase("ja").includes(query));
  });
  els.fileCount.textContent = `${visible.length}件`;
  els.empty.hidden = visible.length > 0 || els.folderGrid.childElementCount > 0;

  for (const file of visible) {
    const item = document.createElement("li");
    item.className = "material-file-item";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "print-file-open";
    button.dataset.fileKey = file.id;
    button.setAttribute("aria-current", String(selectedKey === file.id));
    button.innerHTML =
      '<span class="material-file-icon is-text" aria-hidden="true"><span class="material-file-mark">TXT</span></span>' +
      '<span class="material-file-copy"><strong></strong><small></small></span>' +
      '<i class="bx bx-chevron-right"></i>';
    button.querySelector("strong").textContent = file.name;
    button.querySelector("small").textContent = `Weekly Test原稿・${formatSize(file.size)}`;
    button.addEventListener("click", () => loadLibraryFile(file));
    item.append(button);
    els.fileList.append(item);
  }
}

function renderLibrary() {
  renderBreadcrumb();
  renderFolders();
  renderFiles();
}

async function loadFiles() {
  const query = currentFolderId ? `?folder_id=${encodeURIComponent(currentFolderId)}` : "";
  files = await api(`/files${query}`);
  renderLibrary();
}

async function loadLibrary() {
  setError();
  try {
    folders = await api("/folders");
    if (currentFolderId && !folderById(currentFolderId)) currentFolderId = null;
    await loadFiles();
  } catch (error) {
    setError(error.message);
  }
}

async function openFolder(id) {
  currentFolderId = id || null;
  els.search.value = "";
  try {
    setError();
    await loadFiles();
  } catch (error) {
    setError(error.message);
  }
}

async function fetchFileText(file) {
  const token = getSessionToken();
  const res = await fetch(`${API_BASE}/files/${encodeURIComponent(file.id)}/view`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "原稿の取得に失敗しました。");
  }
  return res.text();
}

function showPreview(text, label, key) {
  const test = parseWeeklyTestDraft(text);
  previewGeneration += 1;
  const generation = previewGeneration;
  selectedKey = key;
  renderFiles();
  els.selectedPath.textContent = label;
  els.previewEmpty.hidden = true;
  els.previewFrame.hidden = false;
  els.action.disabled = true;
  setStatus(`${test.round}回・25問を読み込みました。A4 6ページを組版しています。`);

  els.previewFrame.srcdoc = createPrintDocumentHtml(test, {
    cssHref: "/material-print/print.css?v=1",
    paged: true,
  });

  const fallback = () => {
    if (generation !== previewGeneration || !els.action.disabled) return;
    els.action.disabled = false;
    setStatus(`第${test.round}回の印刷プレビューを作成しました（A4・6ページ）。`, "ready");
  };
  els.previewFrame.addEventListener("load", () => window.setTimeout(fallback, 1800), { once: true });
}

async function loadLibraryFile(file) {
  try {
    setError();
    els.action.disabled = true;
    setStatus(`${file.name}を読み込んでいます。`);
    const text = await fetchFileText(file);
    const path = folderPath(file.folder_id);
    showPreview(text, [path, file.name].filter(Boolean).join(" / "), file.id);
  } catch (error) {
    setError(error.message);
    setStatus(error.message, "error");
  }
}

els.search.addEventListener("input", renderLibrary);

els.localFile.addEventListener("change", async () => {
  const [file] = els.localFile.files || [];
  if (!file) return;
  try {
    setError();
    els.action.disabled = true;
    setStatus(`${file.name}をこの端末内で読み込んでいます。`);
    showPreview(await file.text(), `ローカル原稿 / ${file.name}`, `local:${file.name}:${file.lastModified}`);
  } catch (error) {
    setError(error.message);
    setStatus(error.message, "error");
  } finally {
    els.localFile.value = "";
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== els.previewFrame.contentWindow) return;
  if (event.data?.type !== "works-material-print-ready") return;
  els.action.disabled = false;
  const round = els.previewFrame.contentDocument?.querySelector(".test-heading span:nth-of-type(2)")?.textContent || "教材";
  setStatus(`${round}の印刷プレビューを作成しました（A4・6ページ）。`, "ready");
});

els.action.addEventListener("click", () => {
  const previewWindow = els.previewFrame.contentWindow;
  if (!previewWindow) return;
  previewWindow.focus();
  previewWindow.print();
});

els.signOut.addEventListener("click", async () => {
  await signOutUser();
  window.location.assign("/");
});

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
  },
  onSignedOut: () => {
    window.location.replace("/");
  },
});
