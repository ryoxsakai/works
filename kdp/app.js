import {
  watchAuth,
  getSessionToken,
  signIn,
  signOutUser,
} from "../shared/auth.js?v=12";
const $ = (id) => document.getElementById(id);
const state = {
  books: [],
  book: null,
  chapters: [],
  sections: [],
  section: null,
  dirty: false,
  busy: false,
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
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
async function api(path, { method = "GET", body } = {}) {
  const res = await fetch("/api/kdp/" + path, {
    method,
    headers: {
      Authorization: "Bearer " + getSessionToken(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409)
      throw new Error(
        "別の画面で更新されています。入力は保持しています。原稿をコピーしてから再読込し、最新の版と比較してください。",
      );
    throw new Error(data.error || "操作に失敗しました (" + res.status + ")");
  }
  return data;
}
function guard() {
  if (state.busy) {
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
async function run(fn) {
  try {
    notify("");
    await fn();
  } catch (e) {
    notify(e.message, true);
  }
}
function modal(title, html) {
  $("modal-title").textContent = title;
  $("modal-content").innerHTML = html;
  $("modal").showModal();
}
function fields(data, defs) {
  return defs
    .map(
      ([key, label, type = "text"]) =>
        `<label>${esc(label)}${type === "textarea" ? `<textarea name="${key}" rows="4">${esc(data[key])}</textarea>` : `<input name="${key}" type="${type}" value="${esc(data[key])}" ${key === "title" ? "required" : ""}>`}</label>`,
    )
    .join("");
}
function formDialog(title, data, defs, save, extra = "") {
  modal(
    title,
    `<form id="dialog-form">${fields(data, defs)}${extra}<button type="submit" class="primary">保存</button></form>`,
  );
  $("dialog-form").onsubmit = (e) => {
    e.preventDefault();
    run(async () => {
      const body = Object.fromEntries(new FormData(e.currentTarget));
      await save(body);
      $("modal").close();
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
    : '<div class="panel empty">本がまだありません。「本を作成」から始めてください。</div>';
  $("books").hidden = false;
}
async function openBook(id) {
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
  const data = await api("sections/" + idPath(id));
  state.section = data.section || data;
  state.section.sources = data.sources || state.section.sources || [];
  state.section.proposals = data.proposals || state.section.proposals || [];
  const c = state.chapters.find((c) => c.id === state.section.chapter_id);
  $("location").textContent =
    state.book.title + " / " + (c?.title || "章") + " / " + state.section.title;
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
      $("modal").close();
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
            $("modal").close();
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
      const res = await fetch(
        "/api/kdp/books/" + idPath(state.book.id) + "/images",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + getSessionToken(),
            "Content-Type": file.type,
          },
          body: file,
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "画像の保存に失敗しました");
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
        $("modal").close();
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
            body: { revision: p.revision },
          });
          $("modal").close();
          await refreshBook();
        });
  }
};
$("section-history").onclick = () => {
  if (!guard()) return;
  run(async () => {
    const d = await api("sections/" + idPath(state.section.id) + "/history");
    const history = list(d, "history").map((h) => ({
      ...h,
      snapshot:
        typeof h.snapshot === "string" ? JSON.parse(h.snapshot) : h.snapshot,
    }));
    modal(
      "原稿の履歴",
      history
        .map(
          (h) =>
            `<div class="item"><strong>revision ${esc(h.revision)}</strong><p>${esc(h.created_at || h.updated_at || "")}</p><details><summary>本文を見る</summary><p>${esc(h.body || h.snapshot?.body || "")}</p></details><button data-restore="${esc(h.revision)}">この版を復元</button></div>`,
        )
        .join("") || "<p>履歴がありません。</p>",
    );
    $("modal-content").onclick = (e) => {
      const b = e.target.closest("[data-restore]");
      if (b && confirm("選択した版を新しいrevisionとして復元しますか？"))
        run(async () => {
          await api("sections/" + idPath(state.section.id) + "/restore", {
            method: "POST",
            body: {
              revision: state.section.revision,
              target_revision: Number(b.dataset.restore),
            },
          });
          $("modal").close();
          $("modal-content").onclick = null;
          await refreshBook();
        });
    };
  });
};
for (const b of document.querySelectorAll("[data-export]"))
  b.onclick = () => {
    if (!guard()) return;
    run(async () => {
      const res = await fetch(
        "/api/kdp/books/" +
          idPath(state.book.id) +
          "/export?format=" +
          b.dataset.export,
        { headers: { Authorization: "Bearer " + getSessionToken() } },
      );
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error || "出力に失敗しました",
        );
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download =
        (state.book.title || "manuscript").replace(/[\\/:*?"<>|]/g, "_") +
        "." +
        { markdown: "zip", json: "json", epub: "epub" }[b.dataset.export];
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      notify("原稿を出力しました。");
    });
  };
$("modal-close").onclick = () => {
  $("modal").close();
  $("modal-content").onclick = null;
};
$("sign-in").onclick = () => signIn("/kdp/");
$("sign-out").onclick = () => {
  if (guard())
    run(async () => {
      await signOutUser();
      location.href = "/";
    });
};
window.addEventListener("beforeunload", (e) => {
  if (state.dirty || state.busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.querySelector(".page-header a").onclick = (e) => {
  if (!guard()) e.preventDefault();
};
watchAuth({
  onSignedIn: () => {
    $("workspace").hidden = false;
    $("login").hidden = true;
    $("sign-out").hidden = false;
    run(loadBooks);
  },
  onSignedOut: (err) => {
    $("workspace").hidden = true;
    $("login").hidden = false;
    $("sign-out").hidden = true;
    if (err) notify(err, true);
  },
});
