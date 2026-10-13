import { esc } from "./markdown.js?v=2";
const $ = (id) => document.getElementById(id);
export function createFolderBrowser(hooks) {
  const state = {
    folders: [],
    pages: [],
    current: null,
    view: "folders",
    dialog: null,
  };
  const folder = (id) => state.folders.find((f) => f.id === id);
  const ancestors = (id) => {
    const result = [],
      seen = new Set();
    let f = folder(id);
    while (f && !seen.has(f.id)) {
      seen.add(f.id);
      result.unshift(f);
      f = folder(f.parent_id);
    }
    return result;
  };
  const label = (id) =>
    id
      ? ancestors(id)
          .map((f) => f.name)
          .join(" / ")
      : "未分類";
  const selected = (id) =>
    id === state.current ? ' aria-current="location"' : "";
  const folderButton = (id, name) =>
    `<button type="button" data-folder-open="${esc(id ?? "")}"${selected(id)}>${esc(name)}</button>`;
  function render() {
    const open = new Set(
      [...$("folder-tree").querySelectorAll("details[open]")].map(
        (d) => d.dataset.folder,
      ),
    );
    ancestors(state.current).forEach((f) => open.add(f.id));
    const tree = (parent, depth = 0) => {
      if (depth > 16) return "";
      return state.folders
        .filter((f) => f.parent_id === parent)
        .map(
          (f) =>
            `<details class="material-tree-folder" data-folder="${esc(f.id)}"${open.has(f.id) ? " open" : ""}><summary><span class="material-tree-chevron" aria-hidden="true">›</span><span class="material-folder-icon" aria-hidden="true">▣</span>${folderButton(f.id, f.name)}</summary><div class="material-tree-children">${tree(f.id, depth + 1)}${state.pages
              .filter(
                (p) =>
                  p.folder_id === f.id && (hooks.archived() || !p.archived),
              )
              .map(
                (p) =>
                  `<button type="button" class="material-tree-file" data-page="${esc(p.id)}">${esc(p.title)}${p.archived ? " · アーカイブ" : ""}</button>`,
              )
              .join("")}</div></details>`,
        )
        .join("");
    };
    $("folder-tree").innerHTML =
      folderButton(null, "Wiki / 未分類") +
      tree(null) +
      state.pages
        .filter((p) => !p.folder_id && (hooks.archived() || !p.archived))
        .map(
          (p) =>
            `<button type="button" class="material-tree-file" data-page="${esc(p.id)}">${esc(p.title)}</button>`,
        )
        .join("");
    $("folder-breadcrumb").innerHTML =
      folderButton(null, "Wiki") +
      ancestors(state.current)
        .map(
          (f) =>
            '<span aria-hidden="true"> / </span>' + folderButton(f.id, f.name),
        )
        .join("");
    $("folder-heading").textContent = label(state.current);
    $("rename-folder").hidden = $("move-folder").hidden = !state.current;
    $("folder-grid").innerHTML = state.folders
      .filter((f) => f.parent_id === state.current)
      .map(
        (f) =>
          `<article class="material-folder-card"><button type="button" class="material-folder-open" data-folder-open="${esc(f.id)}"><span class="material-folder-icon" aria-hidden="true">▣</span><span class="material-folder-copy"><strong>${esc(f.name)}</strong></span><span aria-hidden="true">›</span></button></article>`,
      )
      .join("");
  }
  async function refresh() {
    const data = await hooks.api("folders");
    state.folders = data.folders;
    state.pages = data.pages;
    $("tree-limit").hidden = !data.pages_truncated;
    if (state.current && !folder(state.current)) state.current = null;
    render();
  }
  function setCurrent(id) {
    state.current = id && folder(id) ? id : null;
    render();
  }
  function view(mode) {
    if (!hooks.beforeNavigate()) return;
    state.view = mode;
    $("folder-sidebar").hidden = mode !== "tree";
    $("wiki-layout").classList.toggle("wiki-folder-view", mode !== "tree");
    for (const v of ["folders", "tree"]) {
      $("view-" + v).setAttribute("aria-pressed", String(v === mode));
      $("view-" + v).classList.toggle("active", v === mode);
    }
  }
  document.querySelector("#workspace").addEventListener("click", (e) => {
    const button = e.target.closest("[data-folder-open]");
    if (!button) return;
    e.preventDefault();
    if (hooks.beforeNavigate())
      hooks.navigate(button.dataset.folderOpen || null);
  });
  $("view-folders").onclick = () => view("folders");
  $("view-tree").onclick = () => view("tree");
  function targetOptions(excluded) {
    return (
      '<option value="">Wiki / 未分類</option>' +
      state.folders
        .filter((f) => !ancestors(f.id).some((a) => a.id === excluded))
        .map((f) => `<option value="${esc(f.id)}">${esc(label(f.id))}</option>`)
        .join("")
    );
  }
  function close() {
    if (hooks.busy()) return;
    if (hooks.isDialogDirty() && !confirm("未保存の入力を破棄しますか？"))
      return;
    $("folder-dialog").close();
    state.dialog = null;
    hooks.dialogDirty(false);
  }
  $("folder-dialog-close").onclick = $("folder-dialog-cancel").onclick = close;
  $("folder-dialog").addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  $("folder-form").oninput = () => hooks.dialogDirty(true);
  function show(kind) {
    if (!hooks.beforeNavigate()) return;
    hooks.run(async () => {
      await refresh();
      const source =
        kind === "page"
          ? hooks.page()
          : kind === "create"
            ? null
            : folder(state.current);
      if (kind !== "create" && !source) return;
      if (kind === "page" && source.archived) return;
      state.dialog = {
        kind,
        source: source ? { ...source } : null,
        parent: state.current,
      };
      $("folder-dialog-title").textContent = {
        create: "フォルダを作成",
        rename: "フォルダ名を変更",
        move: "フォルダを移動",
        page: "ページを移動",
      }[kind];
      $("folder-name-label").hidden = kind === "page" || kind === "move";
      $("folder-name").required = !$("folder-name-label").hidden;
      $("folder-name").value = kind === "rename" ? source.name : "";
      $("folder-target-label").hidden = kind === "rename";
      $("folder-target").innerHTML = targetOptions(
        kind === "move" ? source.id : null,
      );
      $("folder-target").value =
        kind === "page"
          ? (source.folder_id ?? "")
          : kind === "move"
            ? (source.parent_id ?? "")
            : (state.current ?? "");
      $("folder-dialog-message").textContent = "";
      hooks.dialogDirty(false);
      $("folder-dialog").showModal();
    });
  }
  $("new-folder").onclick = () => show("create");
  $("rename-folder").onclick = () => show("rename");
  $("move-folder").onclick = () => show("move");
  $("move-page").onclick = () => show("page");
  $("folder-form").onsubmit = (e) => {
    e.preventDefault();
    const d = state.dialog;
    if (!d || hooks.busy()) return;
    const target =
        d.kind === "rename"
          ? d.source.parent_id
          : $("folder-target").value || null,
      dest = folder(target),
      name = $("folder-name").value;
    hooks.run(async () => {
      try {
        if (d.kind === "page")
          await hooks.api(
            "pages/" + encodeURIComponent(d.source.id) + "/move",
            {
              revision: d.source.revision,
              folder_id: target,
              folder_revision: dest?.revision,
            },
          );
        else
          await hooks.api(
            "folders" + (d.source ? "/" + encodeURIComponent(d.source.id) : ""),
            {
              name: d.kind === "move" ? d.source.name : name,
              parent_id: target,
              revision: d.source?.revision,
              parent_revision: dest?.revision,
            },
          );
        $("folder-dialog").close();
        state.dialog = null;
        hooks.dialogDirty(false);
        await refresh();
        if (d.kind === "page") await hooks.moved(d.source.id, target);
        else await hooks.reload();
      } catch (error) {
        $("folder-dialog-message").textContent = error.message;
        throw error;
      }
    });
  };
  return {
    refresh,
    render,
    setCurrent,
    folder,
    label,
    current: () => state.current,
    pageTitle: (id) => state.pages.find((p) => p.id === id)?.title,
  };
}
