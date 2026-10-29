import {
  MODULES,
  WIDGETS,
  defaults,
  readLayout,
  validateLayout,
  dayJst,
  todoSummary,
  summaryPreview,
  esc,
} from "./model.mjs";
import { createReader } from "./data.mjs";

const $ = (id) => document.getElementById(id);
const icon = (name) => `<i class="bx ${name}" aria-hidden="true"></i>`;
const time = (value) =>
  value
    ? new Date(value).toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const list = (items, render, empty, alwaysInclude) => {
  const { shown, total, hidden } = summaryPreview(items, alwaysInclude);
  return total
    ? `<p class="dashboard-muted widget-count">全${total}件${hidden ? ` · ${shown.length}件表示` : ""}</p><ul>${shown.map((item) => `<li>${render(item)}</li>`).join("")}</ul>${hidden ? `<p class="dashboard-muted">残り${hidden}件は下のリンクから元の画面で確認できます。</p>` : ""}`
    : `<p class="dashboard-muted">${empty}</p>`;
};

export function createDashboard({
  getSessionToken,
  getGoogleAccessToken,
  onExpired = () => {},
}) {
  let layoutReady = false,
    midnightTimer;
  let user = null,
    epoch = 0,
    layout = defaults(),
    draft = null,
    key = "",
    reader,
    date = dayJst(),
    sort,
    pagePaused = false;
  const cache = new Map(),
    pending = new Map();
  const current = () => draft || layout;
  function message(text) {
    $("dashboard-message").textContent = text;
  }
  function invalidate() {
    epoch++;
    for (const p of pending.values()) p.controller.abort();
    pending.clear();
    cache.clear();
  }
  function changed() {
    return draft && JSON.stringify(draft) !== JSON.stringify(layout);
  }
  function dismiss() {
    if (changed() && !confirm("表示設定の変更を破棄して移動しますか？"))
      return false;
    if (draft) {
      draft = null;
      draw();
    }
    return true;
  }
  function updateDate() {
    clearTimeout(midnightTimer);
    date = dayJst();
    midnightTimer = setTimeout(
      () => {
        invalidate();
        updateDate();
        if (!pagePaused) draw();
      },
      Date.parse(date + "T00:00:00+09:00") + 86400000 - Date.now() + 50,
    );
    $("dashboard-date").textContent =
      new Date(`${date}T00:00:00+09:00`).toLocaleDateString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "long",
        day: "numeric",
        weekday: "long",
      }) + " · 日本時間";
  }
  function shortcutBody() {
    return `<div class="dashboard-shortcut-links">${current()
      .shortcuts.map((path) => {
        const m = MODULES.find((m) => m[0] === path);
        return `<a href="${path}">${icon(m[2])}${m[1]}</a>`;
      })
      .join(
        "",
      )}</div>${current().shortcuts.length ? "" : '<p class="dashboard-muted">表示を編集してリンクを追加できます。</p>'}`;
  }
  function body(id, data) {
    if (id === "lessons")
      return data.unconfigured
        ? '<p class="dashboard-muted">授業管理の設定でカレンダーを選択してください。</p>'
        : list(
            data.events,
            (e) =>
              `<strong>${esc(e.summary || "(無題)")}</strong><small>${e.start?.dateTime ? esc(time(e.start.dateTime) + (e.end?.dateTime ? " – " + time(e.end.dateTime) : "")) : "終日"}</small>`,
            "今日の予定はありません。",
          );
    if (id === "todo") {
      const { planned, due } = todoSummary(data, date);
      return (
        "<h4>今日・持ち越しの予定</h4>" +
        list(
          planned,
          (t) =>
            `<strong>${esc(t.name)}</strong><small>${t.plannedDay < date ? "持ち越し · " : ""}予定 ${esc(t.plannedDay)}${t.deadline ? " · 締切 " + esc(t.deadline) : ""}</small>`,
          "今日までの未完了予定はありません。",
        ) +
        `<h4>締切の確認（7日以内・期限超過）</h4>${due.some((t) => t.deadline < date) ? `<p class="overdue deadline-alert" role="note">期限超過 ${due.filter((t) => t.deadline < date).length}件（すべて表示）</p>` : ""}` +
        list(
          due,
          (t) =>
            `<strong>${esc(t.name)}</strong><small class="${t.deadline < date ? "overdue" : ""}">${t.deadline < date ? "期限超過 · " : ""}締切 ${esc(t.deadline)}</small>`,
          "対象の締切はありません。",
          (t) => t.deadline <= date,
        )
      );
    }
    if (id === "memo")
      return list(
        data,
        (m) =>
          `<strong>${esc(m.title || "(無題)")}</strong><small>更新 ${esc(m.updatedAt || "日時不明")}</small>`,
        "メモはありません。",
      );
    if (id === "materials")
      return list(
        data,
        (m) =>
          `<strong>${esc(m.name)}</strong><small>追加 ${esc(m.created_at || "日時不明")}</small>`,
        "教材はありません。",
      );
    return list(
      data,
      (p) =>
        `<strong>${esc(p.name)}</strong><small class="${p.deadline < date ? "overdue" : ""}">${p.deadline < date ? "期限超過 · " : ""}締切 ${esc(p.deadline)} · ${esc(p.status)}</small>`,
      "未完了の案件はありません。",
      (p) => p.deadline <= date,
    );
  }
  function content(id) {
    if (id === "shortcuts") return shortcutBody();
    if (!user)
      return '<p class="dashboard-muted">ログインすると表示できます。</p>';
    const v = cache.get(id);
    if (v?.error)
      return `<p role="alert">${esc(v.error)}</p><button type="button" data-retry="${id}">再試行</button>`;
    if (!v) return '<p class="dashboard-muted" role="status">読み込み中…</p>';
    return (
      body(id, v.data) + `<p class="widget-updated">更新 ${esc(time(v.at))}</p>`
    );
  }
  function draw(focus) {
    sort?.destroy();
    sort = null;
    $("dashboard-editor").hidden = !draft;
    $("dashboard-edit").hidden = !!draft;
    $("dashboard-edit").disabled = !user || !layoutReady;
    $("dashboard-refresh").disabled = !user;
    $("dashboard-catalog").innerHTML =
      Object.entries(WIDGETS)
        .filter(([id]) => !current().widgets.includes(id))
        .map(
          ([id, w]) =>
            `<button type="button" data-add="${id}">${esc(w.title)}を追加</button>`,
        )
        .join("") || '<p class="dashboard-muted">すべて追加済みです。</p>';
    $("dashboard-shortcuts").innerHTML =
      "<legend>よく使う機能に表示するリンク</legend>" +
      MODULES.map(
        (m) =>
          `<label><input type="checkbox" value="${m[0]}" ${current().shortcuts.includes(m[0]) ? "checked" : ""}>${m[1]}</label>`,
      ).join("");
    $("dashboard-widgets").innerHTML =
      current()
        .widgets.map((id, index) => {
          const w = WIDGETS[id];
          return `<section class="dashboard-widget" data-id="${id}" aria-labelledby="widget-title-${id}">${draft ? `<div class="widget-tools"><button type="button" class="drag-handle" aria-label="${w.title}をドラッグして移動">${icon("bx-move")}移動</button><button type="button" data-move="${id}" data-step="-1" ${index === 0 ? "disabled" : ""} aria-label="${w.title}を前へ">前へ</button><button type="button" data-move="${id}" data-step="1" ${index === current().widgets.length - 1 ? "disabled" : ""} aria-label="${w.title}を後へ">後へ</button><button type="button" data-hide="${id}" aria-label="${w.title}をホームから非表示">非表示</button></div>` : ""}<header><h3 id="widget-title-${id}">${icon(w.icon)}${w.title}</h3></header><p class="dashboard-muted widget-description">${w.description}</p><div data-content="${id}" aria-busy="${user && id !== "shortcuts" && !cache.has(id)}">${content(id)}</div>${w.path ? `<a class="widget-link" href="${w.path}">${w.title === "今日の授業" ? "授業管理" : id === "todo" ? "ToDo" : id === "materials" ? "教材管理" : id === "memo" ? "メモ" : "SS管理"}を開く ${icon("bx-right-arrow-alt")}</a>` : ""}</section>`;
        })
        .join("") ||
      '<p class="dashboard-muted">ウィジェットは非表示になっています。「表示を編集」から追加できます。全機能はメニューから開けます。</p>';
    if (focus) document.querySelector(focus)?.focus();
    if (draft) enableDrag();
    loadVisible();
  }
  let sortablePromise;
  async function enableDrag() {
    const request = epoch;
    try {
      sortablePromise ||= import("./vendor/Sortable-1.15.6.min.js");
      await sortablePromise;
      if (!draft || request !== epoch || sort) return;
      sort = new window.Sortable($("dashboard-widgets"), {
        forceFallback: true,
        fallbackOnBody: true,
        fallbackTolerance: 4,
        handle: ".drag-handle",
        draggable: ".dashboard-widget",
        animation: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 150,
        delay: 150,
        delayOnTouchOnly: true,
        onEnd() {
          if (!draft) return;
          draft.widgets = [
            ...$("dashboard-widgets").querySelectorAll("[data-id]"),
          ].map((n) => n.dataset.id);
          message("順序を変更しました。配置を保存すると確定します。");
          draw(`[data-id="${draft.widgets[0]}"] .drag-handle`);
        },
      });
    } catch {
      message("ドラッグを利用できません。「前へ」「後へ」で並べ替えできます。");
    }
  }
  function patchContent(id) {
    const el = document.querySelector(`[data-content="${id}"]`);
    if (el) {
      el.innerHTML = content(id);
      el.setAttribute("aria-busy", "false");
    }
  }
  async function load(id, force = false) {
    if (
      !user ||
      !layoutReady ||
      pagePaused ||
      id === "shortcuts" ||
      pending.has(id)
    )
      return;
    if (!force && cache.has(id)) return;
    const controller = new AbortController(),
      request = epoch,
      requestedDay = date;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    pending.set(id, { controller });
    const el = document.querySelector(`[data-content="${id}"]`);
    if (el) {
      el.setAttribute("aria-busy", "true");
      if (force) el.innerHTML = '<p role="status">更新中…</p>';
    }
    let abortHandler;
    const aborted = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("aborted", "AbortError"));
      controller.signal.addEventListener("abort", abortHandler, { once: true });
    });
    try {
      const data = await Promise.race([
        reader(id, date, controller.signal),
        aborted,
      ]);
      if (
        request !== epoch ||
        controller.signal.aborted ||
        !current().widgets.includes(id)
      )
        return;
      if (requestedDay !== dayJst()) {
        invalidate();
        updateDate();
        draw();
        return;
      }
      cache.set(id, { data, at: Date.now() });
      patchContent(id);
    } catch (e) {
      if (request === epoch && (!controller.signal.aborted || timedOut)) {
        cache.set(id, {
          error: timedOut
            ? "取得に時間がかかっています。再試行できます。"
            : e.message,
        });
        patchContent(id);
        if (e.status === 401) expire();
      }
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", abortHandler);
      if (pending.get(id)?.controller === controller) pending.delete(id);
    }
  }
  function loadVisible() {
    for (const id of cache.keys())
      if (!current().widgets.includes(id)) cache.delete(id);
    for (const [id, p] of pending)
      if (!current().widgets.includes(id)) {
        p.controller.abort();
        pending.delete(id);
        cache.delete(id);
      }
    for (const id of current().widgets) load(id);
  }
  function expire() {
    invalidate();
    user = null;
    draft = null;
    key = "";
    onExpired();
    message("ログイン状態が変わりました。再読み込みしてログインしてください。");
    draw();
  }
  async function signedIn(info) {
    invalidate();
    const request = epoch;
    layoutReady = false;
    user = info;
    draft = null;
    key = "";
    layout = defaults();
    updateDate();
    reader = createReader({
      session: getSessionToken(),
      googleToken: getGoogleAccessToken,
    });
    draw();
    try {
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(info.email),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (request !== epoch) return;
      key = "works-home-dashboard-v1:" + hash;
      const loaded = readLayout(localStorage, key);
      layout = loaded.layout;
      layoutReady = true;
      message(loaded.error);
      draw();
    } catch {
      if (request === epoch) {
        layoutReady = true;
        message("配置の保存を利用できません。この画面内では編集できます。");
        draw();
      }
    }
  }
  function signedOut() {
    invalidate();
    user = null;
    key = "";
    draft = null;
    layout = defaults();
    message("");
    draw();
  }
  $("dashboard-edit").onclick = () => {
    if (!user || draft) return;
    draft = structuredClone(layout);
    draw("#dashboard-save");
    message("編集中です。変更は配置を保存するまで確定しません。");
  };
  $("dashboard-cancel").onclick = () => {
    draft = null;
    draw("#dashboard-edit");
    message("配置の変更を取り消しました。");
  };
  $("dashboard-save").onclick = () => {
    if (!draft || !user || !layoutReady) return;
    try {
      if (!key) throw new Error();
      const next = validateLayout(draft);
      localStorage.setItem(key, JSON.stringify(next));
      layout = next;
      draft = null;
      draw("#dashboard-edit");
      message("このユーザー・ブラウザの配置を保存しました。");
    } catch {
      message(
        "配置を保存できませんでした。変更は編集中のままです。再試行するかキャンセルできます。",
      );
    }
  };
  $("dashboard-reset").onclick = () => {
    if (
      draft &&
      confirm(
        "初期のウィジェット配置とショートカットに戻しますか？業務データは変更されません。「配置を保存」で確定します。",
      )
    ) {
      draft = defaults();
      draw("#dashboard-save");
      message("初期配置を編集中です。保存すると確定します。");
    }
  };
  $("dashboard-refresh").onclick = () => {
    if (!user) return;
    if (date !== dayJst()) {
      invalidate();
      updateDate();
      draw();
    } else for (const id of current().widgets) load(id, true);
  };
  $("dashboard-catalog").onclick = (e) => {
    const id = e.target.closest("[data-add]")?.dataset.add;
    if (draft && WIDGETS[id] && !draft.widgets.includes(id)) {
      draft.widgets.push(id);
      draw(`[data-id="${id}"] .drag-handle`);
      message(`${WIDGETS[id].title}を追加しました。保存すると確定します。`);
    }
  };
  $("dashboard-shortcuts").onchange = (e) => {
    if (draft && MODULES.some((m) => m[0] === e.target.value)) {
      draft.shortcuts = MODULES.filter(
        (m) =>
          $("dashboard-shortcuts").querySelector(`input[value="${m[0]}"]`)
            .checked,
      ).map((m) => m[0]);
      const el = document.querySelector('[data-content="shortcuts"]');
      if (el) el.innerHTML = shortcutBody();
    }
  };
  $("dashboard-widgets").onclick = (e) => {
    const retry = e.target.closest("[data-retry]");
    if (retry) {
      load(retry.dataset.retry, true);
      return;
    }
    if (!draft) return;
    const hide = e.target.closest("[data-hide]");
    if (hide) {
      draft.widgets = draft.widgets.filter((id) => id !== hide.dataset.hide);
      draw("#dashboard-save");
      message("ホームから非表示にしました。元のデータは変更されません。");
      return;
    }
    const move = e.target.closest("[data-move]");
    if (move) {
      const i = draft.widgets.indexOf(move.dataset.move),
        j = i + Number(move.dataset.step);
      if (i < 0 || j < 0 || j >= draft.widgets.length) return;
      [draft.widgets[i], draft.widgets[j]] = [
        draft.widgets[j],
        draft.widgets[i],
      ];
      draw(`[data-id="${move.dataset.move}"] .drag-handle`);
      message(`${WIDGETS[move.dataset.move].title}の順序を変更しました。`);
    }
  };
  document.addEventListener(
    "click",
    (e) => {
      const link = e.target.closest("a[href]");
      if (
        link &&
        link.origin === location.origin &&
        link.pathname !== "/" &&
        !dismiss()
      )
        e.preventDefault();
    },
    true,
  );
  window.addEventListener("beforeunload", (e) => {
    if (changed()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  window.addEventListener("pagehide", () => {
    pagePaused = true;
    clearTimeout(midnightTimer);
    invalidate();
    sort?.destroy();
    sort = null;
    $("dashboard-widgets").replaceChildren();
  });
  window.addEventListener("pageshow", () => {
    if (pagePaused) {
      pagePaused = false;
      updateDate();
      draw();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !user) return;
    if (date !== dayJst()) {
      invalidate();
      updateDate();
      draw();
    } else
      for (const id of current().widgets) {
        const v = cache.get(id);
        if (v?.at && Date.now() - v.at > 60000) load(id, true);
      }
  });
  window.addEventListener("storage", (e) => {
    if (e.key === "works_session_token" || e.key === null) {
      expire();
    } else if (key && e.key === key) {
      message(
        "別タブで配置が変わりました。再読み込みすると反映されます。現在の編集中設定は保持しています。",
      );
    }
  });
  const nav = $("home-navigation"),
    wide = matchMedia("(min-width: 900px)");
  let navHadFocus = false;
  document.addEventListener("focusin", (e) => {
    navHadFocus = nav.querySelector("nav").contains(e.target);
  });
  const navMode = () => {
    const hiddenFocus =
      !wide.matches &&
      (nav.querySelector("nav").contains(document.activeElement) ||
        (navHadFocus && document.activeElement === document.body));
    nav.open = wide.matches;
    if (hiddenFocus) nav.querySelector("summary").focus();
  };
  navMode();
  wide.addEventListener("change", navMode);
  nav.addEventListener("toggle", () => {
    if (wide.matches && !nav.open) nav.open = true;
  });
  nav.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wide.matches) {
      nav.open = false;
      nav.querySelector("summary").focus();
    }
  });
  $("home-settings-modal").addEventListener("close", () =>
    $("open-home-settings").focus(),
  );
  updateDate();
  draw();
  return {
    signedIn,
    signedOut,
    canLeave: dismiss,
    clear: () => {
      invalidate();
      user = null;
      draft = null;
      draw();
    },
  };
}
