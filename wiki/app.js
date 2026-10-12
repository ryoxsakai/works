import {
  watchAuth,
  getSessionToken,
  signIn,
  signOutUser,
} from "../shared/auth.js?v=12";
import { esc, renderMarkdown } from "./markdown.js";
const $ = (id) => document.getElementById(id),
  state = {
    data: null,
    pages: [],
    offset: 0,
    busy: false,
    dirty: false,
    editing: false,
  };
const path = (id) => encodeURIComponent(id);
function notify(s, error = false) {
  $("message").textContent = s;
  $("message").classList.toggle("error", error);
}
async function api(p, body) {
  const r = await fetch("/api/wiki/" + p, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + getSessionToken(),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      r.status === 409
        ? "別の画面で更新されています。入力は保持しました。コピーしてから最新の版を取得してください。"
        : data.error || `操作に失敗しました (${r.status})`,
    );
  return data;
}
async function run(fn) {
  if (state.busy) return;
  state.busy = true;
  notify("");
  document.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await fn();
  } catch (e) {
    notify(e.message, true);
  } finally {
    state.busy = false;
    document.querySelectorAll("button").forEach((b) => (b.disabled = false));
  }
}
function guard() {
  return !state.dirty || confirm("未保存の入力を破棄しますか？");
}
async function load(more = false) {
  const offset = more ? state.offset : 0;
  const data = await api(
    "pages?q=" +
      encodeURIComponent($("search").value) +
      "&archived=" +
      $("archives").checked +
      "&offset=" +
      offset,
  );
  state.pages = more ? [...state.pages, ...data.pages] : data.pages;
  state.offset = offset + data.pages.length;
  $("more").hidden = !data.has_more;
  $("pages").innerHTML =
    state.pages
      .map(
        (p) =>
          `<button data-page="${esc(p.id)}">${esc(p.title)}<br><small>${p.status === "confirmed" ? "確認済み" : "下書き"} · r${p.revision}${p.archived ? " · アーカイブ" : ""}</small></button>`,
      )
      .join("") || "<p>ページはまだありません。</p>";
}
function compare(a, b, label) {
  const oldLines = a.body.split("\n"),
    newLines = b.body.split("\n");
  $("comparison").innerHTML =
    `<h4>${esc(label)}</h4><p>タイトル: ${esc(a.title)} → ${esc(b.title)}</p><div class="diff"><div><h4>変更前</h4>${oldLines.map((l, i) => `<pre class="${l === newLines[i] ? "" : "removed"}">${esc(l) || " "}</pre>`).join("")}</div><div><h4>変更後</h4>${newLines.map((l, i) => `<pre class="${l === oldLines[i] ? "" : "added"}">${esc(l) || " "}</pre>`).join("")}</div></div><p>出典・タグ・別名・関連ページ・状態</p><div class="diff"><pre>${esc(JSON.stringify({ ...a, body: undefined }, null, 2))}</pre><pre>${esc(JSON.stringify({ ...b, body: undefined }, null, 2))}</pre></div>`;
  $("comparison").scrollIntoView({ block: "nearest" });
}
function render() {
  const { page: p, proposals, history } = state.data;
  $("detail").hidden = false;
  $("title").textContent = p.title;
  $("meta").textContent =
    `${p.status === "confirmed" ? "確認済み" : "下書き"} · revision ${p.revision} · ${p.updated_at}${p.archived ? " · アーカイブ" : ""} · タグ: ${p.tags.join(", ")} · 別名: ${p.aliases.join(", ")}`;
  $("body").innerHTML = renderMarkdown(p.body);
  $("sources").innerHTML =
    p.sources
      .map(
        (s) =>
          `<div class="source">${esc(s.type)} · ${esc(s.id)}${s.url ? ` · <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">原本URL</a>` : ""}<br>${esc(s.location)} · 確認日 ${esc(s.checked_at)}</div>`,
      )
      .join("") || "<p>出典なし</p>";
  $("links").innerHTML =
    p.links
      .map(
        (id) =>
          `<button data-page="${esc(id)}">${esc(state.pages.find((p) => p.id === id)?.title || id)}</button>`,
      )
      .join("") || "<p>なし</p>";
  $("proposals").innerHTML =
    proposals
      .map(
        (v) =>
          `<div class="proposal"><p>${esc(v.notes)} · 元r${v.base_revision} · ${esc(v.status)}</p><button data-compare-proposal="${esc(v.id)}">差分を確認</button>${v.status === "pending" ? `<button data-accept="${esc(v.id)}">採用</button><button data-reject="${esc(v.id)}">却下</button>` : ""}</div>`,
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
}
async function open(id) {
  state.data = await api("pages/" + path(id));
  state.dirty = false;
  state.editing = false;
  $("editor").hidden = true;
  render();
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
    state.dirty = true;
  };
  $("source-fields").append(div);
}
function edit(isNew = false) {
  state.editing = true;
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
  $("editor").hidden = false;
  $("editor").scrollIntoView();
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
$("editor").oninput = () => (state.dirty = true);
$("editor").onsubmit = (e) => {
  e.preventDefault();
  run(async () => {
    const c = content();
    state.data = await api(
      state.new ? "pages" : "pages/" + path(state.editId) + "/save",
      state.new ? c : { revision: state.editRevision, content: c },
    );
    state.dirty = false;
    state.editing = false;
    $("editor").hidden = true;
    render();
    await load();
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
    notify("改稿案を保存しました。本文は採用時に更新されます。");
  });
$("add-source").onclick = () => {
  addSource();
  state.dirty = true;
};
$("cancel").onclick = () => {
  if (guard()) {
    state.dirty = false;
    state.editing = false;
    $("editor").hidden = true;
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
  if (d.compareProposal) {
    const v = state.data.proposals.find((v) => v.id === d.compareProposal);
    compare(p, v.content, "現在の本文と改稿案");
  }
  if (d.history) {
    const h = state.data.history.find((h) => h.revision === Number(d.history));
    compare(h.snapshot, p, `r${h.revision} と現在`);
  }
  for (const action of ["accept", "reject", "restore"])
    if (d[action] && guard()) {
      const v = state.data.proposals.find((v) => v.id === d[action]);
      if (action === "accept") compare(p, v.content, "採用する改稿案");
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
          state.data = await api("pages/" + path(p.id) + "/" + action, {
            revision: p.revision,
            ...(action === "restore"
              ? { target_revision: Number(d[action]) }
              : { proposal_id: d[action] }),
          });
          render();
          await load();
        });
    }
  if (d.export)
    run(async () => {
      const r = await fetch(
        "/api/wiki/pages/" + path(p.id) + "/export?format=" + d.export,
        { headers: { Authorization: "Bearer " + getSessionToken() } },
      );
      if (!r.ok) throw new Error("exportに失敗しました");
      const u = URL.createObjectURL(await r.blob()),
        a = document.createElement("a");
      a.href = u;
      a.download = "wiki-" + p.id + (d.export === "markdown" ? ".md" : ".json");
      a.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    });
};
$("sign-in").onclick = () => {
  localStorage.setItem("works_pending_destination", "/wiki/");
  signIn("/tutor/");
};
$("sign-out").onclick = () => {
  if (guard())
    run(async () => {
      await signOutUser();
      location.href = "/";
    });
};
document.querySelector(".page-header a").onclick = (e) => {
  if (!guard()) e.preventDefault();
};
window.addEventListener("beforeunload", (e) => {
  if (state.dirty || state.busy) {
    e.preventDefault();
    e.returnValue = "";
  }
});
watchAuth({
  onSignedIn: () => {
    $("workspace").hidden = false;
    $("login").hidden = true;
    $("sign-out").hidden = false;
    run(() => load());
  },
  onSignedOut: (err) => {
    $("workspace").hidden = true;
    $("login").hidden = false;
    $("sign-out").hidden = true;
    if (err) notify(err, true);
  },
});
