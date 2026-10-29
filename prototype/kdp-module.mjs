import {assertKdpAck,assertKdpImage} from './kdp-model.mjs';
import view from './kdp-view.html?raw';import './kdp-native.css';
export function mountKdp(root,context){let alive=true,operation=false,stopped=false,attempt=null,modalReturn=null,modalDirty=false;const lifecycle=new AbortController(),objectUrls=new Set();context.metrics.mounts++;root.classList.add('kdp-native');root.innerHTML='<p><a class="external" href="/kdp/">従来のKDP管理画面へ ↗</a></p>'+view;
function closeModal(force=false){if(!force&&(operation||stopped))return;modalDirty=false;root.querySelector('#modal').close();}
function recovery(){if(root.querySelector('[data-kdp-recovery]'))return;const panel=document.createElement('section');panel.dataset.kdpRecovery='';panel.setAttribute('role','alert');panel.innerHTML='<p>保存の競合・結果未確認、または保存後の再読込失敗のため更新を停止しました。自動再送せず入力と操作情報を保持します。同名の本や節を保存成功とみなしません。</p><button data-inspect>最新を読み取りで確認</button><button data-receipt>入力と操作情報を保存</button><button data-reset>未保存入力を破棄して再読込</button><pre hidden></pre>';(root.querySelector('dialog[open]')||root).prepend(panel);panel.querySelector('[data-inspect]').onclick=async()=>{if(operation)return;operation=true;try{const path=state.section?'sections/'+idPath(state.section.id):state.book?'books/'+idPath(state.book.id):'books';const latest=await context.request('/api/kdp/'+path,{signal:lifecycle.signal});if(!alive)return;const pre=panel.querySelector('pre');pre.hidden=false;pre.textContent=JSON.stringify({latest,attempt},null,2);}catch(e){notify(e.message,true);}finally{operation=false;}};panel.querySelector('[data-receipt]').onclick=()=>{const data={attempt,section:state.section,book:state.book,inputs:[...root.querySelectorAll('input,textarea')].filter(e=>e.type!=='file').map(e=>({id:e.id,name:e.name,value:e.value}))};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));objectUrls.add(url);const a=document.createElement('a');a.href=url;a.download='works-kdp-unsaved.json';a.click();};panel.querySelector('[data-reset]').onclick=()=>{if(!operation&&confirm('未確認の操作は再送せず、入力を破棄して読み直しますか？'))location.reload();};}
root.addEventListener('click',e=>{if((operation||stopped)&&!e.target.closest('[data-kdp-recovery]')){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,signal:lifecycle.signal});
root.addEventListener('submit',e=>{if(operation||stopped){e.preventDefault();e.stopImmediatePropagation();}},{capture:true,signal:lifecycle.signal});
const $ = (id) => root.querySelector("#"+id);
const state = {
  books: [],
  book: null,
  chapters: [],
  sections: [],
  section: null,
  dirty: false,
  busy: false,
  dialogBusy: false,
};
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const idPath = (id) => encodeURIComponent(id);
const list = (data, key) => (Array.isArray(data) ? data : data[key] || []);
function notify(text, error = false) {
 if(!alive)return;
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
async function api(path,{method='GET',body}={}){
 if(stopped&&method!=='GET')throw Error('更新を停止しています。');
 if(method!=='GET')attempt={path,method,body:structuredClone(body),acknowledged:false};
 try{const result=await context.request('/api/kdp/'+path,{method,body,signal:lifecycle.signal});if(!alive)throw new DOMException('Unmounted','AbortError');if(method!=='GET'){attempt.result=result;assertKdpAck(path,method,body,result,state.section?.proposals?.find(p=>path==='proposals/'+idPath(p.id)+'/accept'));attempt.acknowledged=true;}return result;}
 catch(error){if(alive&&method!=='GET'&&![400,413].includes(error.status)){stopped=true;recovery();}throw error;}
}

function guard() {
  if (stopped || state.busy || state.dialogBusy) {
    notify("保存が終わるまでお待ちください。");
    return false;
  }
  return (
    !state.dirty ||
    confirm("未保存の変更があります。変更を破棄して移動しますか？")
  );
}
function setBusy(value) {
  state.busy = value;
  for (const id of ["section-title", "section-content", "image-upload"])
    $(id).disabled = value;
  dirty(state.dirty);
}
function dirty(value) {
  state.dirty = value;
  $("save-status").textContent = value
    ? "未保存の変更があります"
    : state.section
      ? "保存済み · revision " + state.section.revision
      : "";
  $("save").disabled = !value || state.busy;
}
async function run(fn){if(operation||stopped){notify('処理中または結果未確認のため更新を停止しています。',true);return;}operation=true;attempt=null;root.setAttribute('aria-busy','true');const locked=[];try{notify('');const task=fn();for(const e of root.querySelectorAll('input,textarea,select,button'))if(!e.disabled&&!e.closest('[data-kdp-recovery]')){e.disabled=true;locked.push(e);}await task;}catch(error){if(alive&&error.name!=='AbortError'){if(attempt?.acknowledged){stopped=true;recovery();}notify(error.message,true);}}finally{operation=false;if(alive){root.setAttribute('aria-busy','false');if(stopped)root.querySelectorAll('input,textarea,select,button').forEach(e=>{if(!e.closest('[data-kdp-recovery]'))e.disabled=true;});else {for(const e of locked)if(e.isConnected)e.disabled=false;dirty(state.dirty);}}}}

function modal(title, html) {
  if (state.dialogBusy) return;
  $("modal-content").onclick = null;
  $("modal-title").textContent = title;
  $("modal-content").innerHTML = html;
  modalReturn=document.activeElement;modalDirty=false;$("modal").showModal();
}
function fields(data, defs) {
  return defs
    .map(
      ([key, label, type = "text"]) =>
        `<label>${esc(label)}${type === "textarea" ? `<textarea name="${key}" rows="4">${esc(data[key])}</textarea>` : `<input name="${key}" type="${type}" value="${esc(data[key])}" ${key === "title" ? 'required maxlength="300"' : ""}>`}</label>`,
    )
    .join("");
}
function formDialog(title, data, defs, save, extra = "") {
  modal(
    title,
    `<form id="dialog-form">${fields(data, defs)}${extra}<button type="submit" class="primary">保存</button></form>`,
  );
  const form = $("dialog-form");
  let pending = false;
  form.onsubmit = (e) => {
    e.preventDefault();
    if (pending) return;
    // Capture values before disabling controls: disabled fields are absent from FormData.
    const body = Object.fromEntries(new FormData(form));
    pending = true;
    state.dialogBusy = true;
    const controls = [...form.elements, $("modal-close")];
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => {
      control.disabled = true;
    });
    run(async () => {
      try {
        await save(body);
        closeModal(true);
      } finally {
        state.dialogBusy = false;
        pending = false;
        controls.forEach((control, index) => {
          control.disabled = disabled[index];
        });
      }
    });
  };
}
async function loadBooks() {
  const data = await api(
    "books?include_archived=" + ($("show-archived").checked ? "1" : "0"),
  );
  state.books = list(data, "books").filter(
    (b) => $("show-archived").checked || !b.archived,
  );
  $("books").innerHTML = state.books.length
    ? state.books
        .map(
          (b) =>
            `<button class="book-card ${b.archived ? "archived" : ""}" data-book="${esc(b.id)}"><strong>${esc(b.title)}</strong><small>${esc(b.author || "著者未設定")} · ${esc(b.language || "en")}</small><small>${esc(b.audience || "想定読者未設定")}</small>${b.archived ? "<span>アーカイブ</span>" : ""}</button>`,
        )
        .join("")
    : '<div class="kdp-surface empty">本がまだありません。「本を作成」から始めてください。</div>';
  $("books").hidden = false;
}
async function openBook(id) {
  const priorBusy = state.busy;
  setBusy(true);
  try {
    const data = await api("books/" + idPath(id));
    state.book = data.book || data;
    state.chapters = data.chapters || state.book.chapters || [];
    state.sections =
      data.sections ||
      state.chapters.flatMap((c) =>
        (c.sections || []).map((s) => ({
          ...s,
          chapter_id: s.chapter_id || c.id,
        })),
      );
    state.section = null;
    dirty(false);
    $("books").hidden = true;
    $("book-panel").hidden = false;
    $("book-name").textContent = state.book.title;
    $("editor").hidden = true;
    $("editor-empty").hidden = false;
    outline();
  } finally {
    setBusy(priorBusy);
  }
}
function outline() {
  const visible = (x) => $("show-archived").checked || !x.archived;
  const sorted = (xs) =>
    xs.filter(visible).sort((a, b) => a.sort_order - b.sort_order);
  $("outline").innerHTML = sorted(state.chapters)
    .map(
      (c) =>
        `<div class="chapter ${c.archived ? "archived" : ""}"><div class="outline-row"><button class="outline-name" data-edit-chapter="${esc(c.id)}">${esc(c.title)}</button><button class="move" data-move-chapter="${esc(c.id)}" data-direction="-1" aria-label="章を上へ">↑</button><button class="move" data-move-chapter="${esc(c.id)}" data-direction="1" aria-label="章を下へ">↓</button></div><div class="outline-sections">${sorted(
          state.sections.filter((s) => s.chapter_id === c.id),
        )
          .map(
            (s) =>
              `<div class="outline-row"><button class="outline-name ${state.section?.id === s.id ? "selected" : ""} ${s.archived ? "archived" : ""}" data-section="${esc(s.id)}">${esc(s.title)}${s.archived ? "（アーカイブ）" : ""}</button><button class="move" data-move-section="${esc(s.id)}" data-direction="-1" aria-label="節を上へ">↑</button><button class="move" data-move-section="${esc(s.id)}" data-direction="1" aria-label="節を下へ">↓</button></div>`,
          )
          .join(
            "",
          )}<button data-new-section="${esc(c.id)}">＋ 節</button></div></div>`,
    )
    .join("");
}
async function openSection(id) {
  const priorBusy = state.busy;
  setBusy(true);
  try {
    const data = await api("sections/" + idPath(id));
    state.section = data.section || data;
    state.section.sources = data.sources || state.section.sources || [];
    state.section.proposals = data.proposals || state.section.proposals || [];
    const c = state.chapters.find((c) => c.id === state.section.chapter_id);
    $("location").textContent =
      state.book.title +
      " / " +
      (c?.title || "章") +
      " / " +
      state.section.title;
    $("section-title").value = state.section.title;
    $("section-content").value = state.section.body || "";
    $("section-archive").textContent = state.section.archived
      ? "アーカイブから戻す"
      : "アーカイブ";
    $("editor").hidden = false;
    $("editor-empty").hidden = true;
    dirty(false);
    outline();
    await reloadExtras();
  } finally {
    setBusy(priorBusy);
  }
}
function renderSources() {
  $("sources").innerHTML =
    state.section.sources
      .map(
        (s) =>
          `<div class="item"><a href="${esc(/^https?:\/\//.test(s.url) ? s.url : "#")}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>${s.archived ? '<span class="badge"> アーカイブ</span>' : ""}<p>${esc(s.checked_at || "確認日未設定")} · 対象年度 ${esc(s.target_year || "未設定")}</p><p>${esc(s.notes)}</p><button data-edit-source="${esc(s.id)}">編集</button></div>`,
      )
      .join("") || '<p class="hint">出典がありません。</p>';
}
function renderProposals() {
  $("proposals").innerHTML =
    state.section.proposals
      .map(
        (p) =>
          `<div class="item"><strong>${esc(p.title || "改稿案")}</strong><p class="hint">元 revision ${esc(p.base_revision)} · ${esc(p.status || "pending")}</p><p>${esc(p.notes || "")}</p><button data-proposal="${esc(p.id)}">本文と比較</button></div>`,
      )
      .join("") || '<p class="hint">改稿案がありません。</p>';
}
async function refreshBook() {
  const sid = state.section?.id;
  await openBook(state.book.id);
  if (sid) await openSection(sid);
}
const bookDefs = [
  ["title", "本タイトル"],
  ["subtitle", "サブタイトル"],
  ["author", "著者"],
  ["language", "本文言語（en / ja）"],
  ["audience", "想定読者", "textarea"],
  ["description", "概要・執筆方針", "textarea"],
];
$("new-book").onclick = () => {
  if (!guard()) return;
  formDialog("本を作成", { language: "en" }, bookDefs, async (b) => {
    const d = await api("books", { method: "POST", body: b });
    await loadBooks();
    await openBook((d.book || d).id);
  });
};
$("books").onclick = (e) => {
  const b = e.target.closest("[data-book]");
  if (b && guard()) run(() => openBook(b.dataset.book));
};
$("back-books").onclick = () => {
  if (!guard()) return;
  state.section = null;
  dirty(false);
  $("book-panel").hidden = true;
  run(loadBooks);
};
$("show-archived").onchange = () => {
  if (state.book && !$("book-panel").hidden) {
    outline();
    if (state.section) run(reloadExtras);
  } else run(loadBooks);
};
$("book-settings").onclick = () => {
  if (!guard()) return;
  formDialog(
    "本の設定",
    state.book,
    bookDefs,
    async (b) => {
      await api("books/" + idPath(state.book.id), {
        method: "PATCH",
        body: { ...b, revision: state.book.revision },
      });
      await refreshBook();
    },
    `<button type="button" id="archive-book">${state.book.archived ? "アーカイブから戻す" : "本をアーカイブ"}</button>`,
  );
};
$("modal-content").addEventListener("click", (e) => {
  if (e.target.id === "archive-book")
    run(async () => {
      if (!guard()) return;
      await api("books/" + idPath(state.book.id), {
        method: "PATCH",
        body: { revision: state.book.revision, archived: !state.book.archived },
      });
      closeModal(true);
      $("book-panel").hidden = true;
      state.section = null;
      dirty(false);
      await loadBooks();
    });
});
$("new-chapter").onclick = () => {
  if (!guard()) return;
  formDialog("章を追加", {}, [["title", "章タイトル"]], async (b) => {
    await api("books/" + idPath(state.book.id) + "/chapters", {
      method: "POST",
      body: {
        ...b,
        sort_order:
          Math.max(0, ...state.chapters.map((c) => c.sort_order)) + 1024,
      },
    });
    await refreshBook();
  });
};
$("outline").onclick = (e) => {
  const b = e.target.closest("button");
  if (!b || !guard()) return;
  run(async () => {
    if (b.dataset.section) return openSection(b.dataset.section);
    if (b.dataset.newSection)
      return formDialog(
        "節を追加",
        {},
        [["title", "節タイトル"]],
        async (body) => {
          const d = await api(
            "chapters/" + idPath(b.dataset.newSection) + "/sections",
            {
              method: "POST",
              body: {
                ...body,
                sort_order:
                  Math.max(
                    0,
                    ...state.sections
                      .filter((s) => s.chapter_id === b.dataset.newSection)
                      .map((s) => s.sort_order),
                  ) + 1024,
              },
            },
          );
          await refreshBook();
          await openSection((d.section || d).id);
        },
      );
    if (b.dataset.editChapter) {
      const c = state.chapters.find((c) => c.id === b.dataset.editChapter);
      return (
        formDialog(
          "章を編集",
          c,
          [["title", "章タイトル"]],
          async (body) => {
            await api("chapters/" + idPath(c.id), {
              method: "PATCH",
              body: { ...body, revision: c.revision },
            });
            await refreshBook();
          },
          `<button type="button" id="archive-chapter">${c.archived ? "復元" : "アーカイブ"}</button>`,
        ),
        ($("archive-chapter").onclick = () =>
          run(async () => {
            await api("chapters/" + idPath(c.id), {
              method: "PATCH",
              body: { revision: c.revision, archived: !c.archived },
            });
            closeModal(true);
            await refreshBook();
          }))
      );
    }
    const kind = b.dataset.moveChapter ? "chapters" : "sections",
      id = b.dataset.moveChapter || b.dataset.moveSection;
    if (id) {
      const item = (kind === "chapters" ? state.chapters : state.sections).find(
        (x) => x.id === id,
      );
      const items = (
        kind === "chapters"
          ? state.chapters
          : state.sections.filter((s) => s.chapter_id === item.chapter_id)
      )
        .filter((x) => !x.archived)
        .sort((a, b) => a.sort_order - b.sort_order);
      const i = items.findIndex((x) => x.id === id),
        j = i + Number(b.dataset.direction);
      if (i < 0 || j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      await api(
        (kind === "chapters"
          ? "books/" + idPath(state.book.id)
          : "chapters/" + idPath(item.chapter_id)) + "/reorder",
        {
          method: "POST",
          body: {
            [kind]: items.map((x) => ({ id: x.id, revision: x.revision })),
          },
        },
      );
      await refreshBook();
    }
  });
};
$("image-upload").onchange = () =>
  run(async () => {
    const file = $("image-upload").files[0];
    if (!file) return;
    if (
      !["image/png", "image/jpeg"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    )
      throw new Error("画像は5 MB以下のPNGまたはJPEGを選択してください。");
    const sectionId = state.section.id;
    setBusy(true);
    try {
      attempt={path:'books/'+idPath(state.book.id)+'/images',method:'POST',file:{name:file.name,size:file.size,type:file.type},acknowledged:false};
      let data;try{data=await context.request('/api/kdp/'+attempt.path,{method:'POST',rawBody:file,signal:lifecycle.signal});if(!alive)throw new DOMException('Unmounted','AbortError');attempt.result=data;assertKdpImage(state.book.id,file,data);attempt.acknowledged=true;}catch(error){if(attempt&&error.kdpOperation)attempt.reference=error.kdpOperation;if(alive&&![400,413].includes(error.status)){stopped=true;recovery();}throw error;}
      if (state.section?.id !== sectionId)
        throw new Error("節が変更されたため画像を挿入できませんでした。");
      const textarea = $("section-content");
      textarea.setRangeText(
        "\n" + data.image.markdown + "\n",
        textarea.selectionStart,
        textarea.selectionEnd,
        "end",
      );
      dirty(true);
      $("image-upload").value = "";
      notify("画像を挿入しました。原稿を保存してください。");
    } finally {
      setBusy(false);
    }
  });
for (const id of ["section-title", "section-content"])
  $(id).addEventListener("input", () => dirty(true));
$("section-form").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    setBusy(true);
    dirty(true);
    try {
      await api("sections/" + idPath(state.section.id), {
        method: "PATCH",
        body: {
          title: $("section-title").value,
          body: $("section-content").value,
          revision: state.section.revision,
        },
      });
      dirty(false);
      await refreshBook();
      notify("原稿を保存しました。");
    } finally {
      setBusy(false);
    }
  });
};
$("section-archive").onclick = () => {
  if (!guard()) return;
  run(async () => {
    await api("sections/" + idPath(state.section.id), {
      method: "PATCH",
      body: {
        revision: state.section.revision,
        archived: !state.section.archived,
      },
    });
    await refreshBook();
  });
};
const sourceDefs = [
  ["title", "出典名"],
  ["url", "出典URL", "url"],
  ["checked_at", "確認日", "date"],
  ["target_year", "対象年度"],
  ["notes", "補足", "textarea"],
];
function sourceDialog(s) {
  if (state.busy || state.dialogBusy) {
    notify("読み込みが終わるまでお待ちください。");
    return;
  }
  formDialog(
    s.id ? "出典を編集" : "出典を追加",
    s,
    sourceDefs,
    async (b) => {
      await api(
        s.id
          ? "sources/" + idPath(s.id)
          : "sections/" + idPath(state.section.id) + "/sources",
        {
          method: s.id ? "PATCH" : "POST",
          body: { ...b, ...(s.id ? { revision: s.revision } : {}) },
        },
      );
      await reloadExtras();
    },
    s.id
      ? `<button type="button" id="archive-source">${s.archived ? "復元" : "アーカイブ"}</button>`
      : "",
  );
  if (s.id)
    $("archive-source").onclick = () =>
      run(async () => {
        await api("sources/" + idPath(s.id), {
          method: "PATCH",
          body: { revision: s.revision, archived: !s.archived },
        });
        closeModal(true);
        await reloadExtras();
      });
}
async function reloadExtras() {
  const [s, p] = await Promise.all([
    api(
      "sections/" +
        idPath(state.section.id) +
        "/sources?include_archived=" +
        ($("show-archived").checked ? "1" : "0"),
    ),
    api("sections/" + idPath(state.section.id) + "/proposals"),
  ]);
  state.section.sources = list(s, "sources").filter(
    (s) => $("show-archived").checked || !s.archived,
  );
  state.section.proposals = list(p, "proposals");
  renderSources();
  renderProposals();
}
$("new-source").onclick = () => sourceDialog({});
$("sources").onclick = (e) => {
  const b = e.target.closest("[data-edit-source]");
  if (b)
    sourceDialog(
      state.section.sources.find((s) => s.id === b.dataset.editSource),
    );
};
$("new-proposal").onclick = () => {
  if (!guard()) return;
  formDialog(
    "改稿案を保存",
    { body: state.section.body },
    [
      ["title", "提案タイトル"],
      ["body", "提案本文", "textarea"],
      ["notes", "変更理由", "textarea"],
    ],
    async (b) => {
      await api("sections/" + idPath(state.section.id) + "/proposals", {
        method: "POST",
        body: { ...b, base_revision: state.section.revision },
      });
      await reloadExtras();
    },
  );
};
function diffMarkup(before, after) {
  const a = before.split("\n"),
    b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - 1 - end] === b[b.length - 1 - end]
  )
    end++;
  const render = (xs, tag) =>
    esc(xs.slice(0, start).join("\n")) +
    (start ? "\n" : "") +
    "<" +
    tag +
    ">" +
    esc(xs.slice(start, end ? xs.length - end : xs.length).join("\n")) +
    "</" +
    tag +
    ">" +
    (end ? "\n" + esc(xs.slice(-end).join("\n")) : "");
  return [render(a, "del"), render(b, "ins")];
}
$("proposals").onclick = (e) => {
  const b = e.target.closest("[data-proposal]");
  if (!b) return;
  if (!guard()) return;
  const p = state.section.proposals.find((p) => p.id === b.dataset.proposal);
  const [before, after] = diffMarkup(state.section.body || "", p.body || "");
  modal(
    "改稿案を比較",
    `<p>元 revision ${esc(p.base_revision)} / 現在 ${esc(state.section.revision)}</p><div class="diff"><div><h3>採用済み本文</h3><pre>${before}</pre></div><div><h3>改稿案</h3><pre>${after}</pre></div></div>${p.status === "pending" || !p.status ? '<div class="item-actions"><button id="accept-proposal" class="primary">この案を採用</button><button id="reject-proposal">却下</button></div>' : ""}`,
  );
  for (const action of ["accept", "reject"]) {
    const button = $(action + "-proposal");
    if (button)
      button.onclick = () =>
        run(async () => {
          await api("proposals/" + idPath(p.id) + "/" + action, {
            method: "POST",
            body: { revision: p.revision, base_revision:p.base_revision },
          });
          closeModal(true);
          await refreshBook();
        });
  }
};
$("section-history").onclick = () => {
  if (!guard()) return;
  const sectionId = state.section.id;
  const sectionRevision = state.section.revision;
  let nextBefore = null;
  let loading = false;
  async function loadPage(append = false) {
    if (loading) return;
    loading = true;
    const priorBusy = state.busy;
    setBusy(true);
    const controls = [...$("modal-content").querySelectorAll("button")];
    controls.forEach((control) => {
      control.disabled = true;
    });
    const more = $("history-more");
    if (more) more.disabled = true;
    try {
      const query =
        append && nextBefore ? "&before_revision=" + nextBefore : "";
      const data = await api(
        "sections/" + idPath(sectionId) + "/history?limit=10" + query,
      );
      if (
        state.section?.id !== sectionId ||
        (append && (!$("modal").open || !$("history-list")))
      )
        return;
      const history = list(data, "history").map((h) => ({
        ...h,
        snapshot:
          typeof h.snapshot === "string" ? JSON.parse(h.snapshot) : h.snapshot,
      }));
      const html = history
        .map(
          (h) =>
            `<div class="item"><strong>revision ${esc(h.revision)}</strong><p>${esc(h.created_at || h.updated_at || "")}</p><details><summary>本文を見る</summary><p>${esc(h.body || h.snapshot?.body || "")}</p></details><button data-restore="${esc(h.revision)}">この版を復元</button></div>`,
        )
        .join("");
      if (!append)
        modal(
          "原稿の履歴",
          '<div id="history-list"></div><button id="history-more" type="button" hidden>以前の履歴を読み込む</button>',
        );
      $("history-list").insertAdjacentHTML(
        "beforeend",
        html || (!append ? "<p>履歴がありません。</p>" : ""),
      );
      nextBefore = data.next_before_revision ?? null;
      $("history-more").hidden = !nextBefore;
      $("history-more").onclick = () => run(() => loadPage(true));
      $("modal-content").onclick = (e) => {
        const button = e.target.closest("[data-restore]");
        if (
          !button ||
          state.dialogBusy ||
          state.busy ||
          state.section?.id !== sectionId ||
          !confirm("選択した版を新しいrevisionとして復元しますか？")
        )
          return;
        state.dialogBusy = true;
        $("modal-close").disabled = true;
        for (const control of $("modal-content").querySelectorAll("button"))
          control.disabled = true;
        run(async () => {
          try {
            await api("sections/" + idPath(sectionId) + "/restore", {
              method: "POST",
              body: {
                revision: sectionRevision,
                target_revision: Number(button.dataset.restore),
              },
            });
            closeModal(true);
            $("modal-content").onclick = null;
            await refreshBook();
          } finally {
            state.dialogBusy = false;
            $("modal-close").disabled = false;
            for (const control of $("modal-content").querySelectorAll("button"))
              control.disabled = false;
          }
        });
      };
    } finally {
      loading = false;
      setBusy(priorBusy);
      controls.forEach((control) => {
        control.disabled = false;
      });
      if ($("history-more")) $("history-more").disabled = state.dialogBusy;
    }
  }
  run(() => loadPage());
};
for (const b of root.querySelectorAll("[data-export]"))
  b.onclick = () => {
    if (!guard()) return;
    run(async () => {
      const blob=await context.request('/api/kdp/books/'+idPath(state.book.id)+'/export?format='+b.dataset.export,{responseType:'blob',signal:lifecycle.signal});if(!alive)return;const url=URL.createObjectURL(blob);objectUrls.add(url);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (state.book.title || "manuscript").replace(/[\\/:*?"<>|]/g, "_") +
        "." +
        { markdown: "zip", json: "json", epub: "epub" }[b.dataset.export];
      a.click();
      setTimeout(() => {URL.revokeObjectURL(url);objectUrls.delete(url);}, 30000);
      notify("原稿を出力しました。");
    });
  };
$("modal").addEventListener("cancel", (e) => {
  if(operation||stopped||state.dialogBusy||modalDirty&&!confirm("未保存の入力を破棄して閉じますか？"))e.preventDefault();
});
$("modal-close").onclick = () => {
  if (operation||stopped||state.dialogBusy) return;
  if(modalDirty&&!confirm("未保存の入力を破棄して閉じますか？"))return;
  closeModal(true);
  $("modal-content").onclick = null;
};

$('modal').addEventListener('input',()=>modalDirty=true);$('modal').addEventListener('close',()=>{if(modalReturn?.isConnected)modalReturn.focus();});
run(loadBooks);
return {get dirty(){return state.dirty||modalDirty||operation||stopped;},canLeave(){return !operation&&!state.busy&&!state.dialogBusy&&(!(state.dirty||modalDirty||stopped)||confirm('未保存の入力または結果未確認の操作があります。情報を保存してから、破棄して移動しますか？'));},beforeHistoryLeave(){if($('modal').open){if(!operation&&!stopped&&(!modalDirty||confirm('未保存の入力を破棄して閉じますか？')))closeModal(true);return false;}return true;},unmount(){alive=false;lifecycle.abort();for(const url of objectUrls)URL.revokeObjectURL(url);$('modal').close();root.replaceChildren();context.metrics.unmounts++;}};
}
