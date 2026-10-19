import {
  watchAuth,
  signIn,
  signOutUser,
  getSessionToken,
} from "/shared/auth.js?v=12";
const $ = (x) => document.querySelector(x);
const states = {
  unfinished: "未完了",
  queued: "未着手",
  running: "進行中",
  review: "確認待ち",
  waiting: "待機",
  paused: "一時停止",
  completed: "完了",
  cancelled: "中止",
};
const dateJP = (x) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(x));
const stamp = (x) =>
  x
    ? new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(x))
    : "未実施";
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
const button = (text, action, target = "#error") => {
  const b = node("button", text);
  b.type = "button";
  b.addEventListener("click", () => guard(action, target));
  return b;
};
let state,
  filter = "unfinished",
  selected = dateJP(Date.now()),
  editing = null,
  viewing = null,
  busy = false,
  signedIn = false;
let runViewGeneration = 0;
const manualKeys = new Map();
async function api(body, query = "") {
  const r = await fetch("/api/workflow" + query, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: "Bearer " + getSessionToken(),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok)
    throw new Error(
      (r.status === 409
        ? "他の更新が入りました。更新して内容を確認してください。 "
        : "") + (d.error || r.status),
    );
  return d;
}
async function guard(fn, target = "#error") {
  if (busy) return;
  busy = true;
  $(target).textContent = "";
  try {
    await fn();
  } catch (e) {
    $(target).textContent = e.message;
  } finally {
    busy = false;
  }
}
async function load() {
  state = await api();
  render();
  $("#coverage").textContent =
    (state.next_offset
      ? "最新500件の Run を表示しています。古い実行は API の offset で確認できます。 "
      : "") +
    (state.definitions_truncated ? "定義は先頭200件を表示しています。" : "");
}
function matched(r) {
  return filter === "unfinished"
    ? !["completed", "cancelled"].includes(r.status)
    : filter === r.status;
}
function shift(n) {
  const d = new Date(selected + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  selected = d.toISOString().slice(0, 10);
  render();
}
function render() {
  $("#day").value = selected;
  const cfg = state.settings;
  $("#patrol-status").replaceChildren(
    node("strong", cfg.stopped ? "全体停止中" : "巡回状態"),
    node(
      "div",
      `希望 ${cfg.desired_interval}分 / 実際 ${cfg.actual_interval ? cfg.actual_interval + "分" : "未設定"}${cfg.actual_interval !== cfg.desired_interval ? " ・設定未反映" : ""}`,
    ),
    node("div", "最終巡回 " + stamp(cfg.last_patrol)),
  );
  $("#interval").value = cfg.desired_interval;
  $("#global-stop").textContent = cfg.stopped ? "全体停止を解除" : "全体停止";
  $("#filters").replaceChildren(
    ...Object.entries(states).map(([k, v]) => {
      const count = state.runs.filter((r) =>
        k === "unfinished"
          ? !["completed", "cancelled"].includes(r.status)
          : r.status === k,
      ).length;
      const b = button(`${v} ${count}`, () => {
        filter = k;
        render();
      });
      b.setAttribute("aria-pressed", String(filter === k));
      return b;
    }),
  );
  const anchor = new Date(selected + "T00:00:00Z");
  anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = anchor.toISOString().slice(0, 10),
      el = node(
        "section",
        undefined,
        "wf-day" +
          (selected === day ? " selected" : "") +
          (day === dateJP(Date.now()) ? " today" : ""),
      );
    el.append(
      node(
        "h3",
        new Intl.DateTimeFormat("ja-JP", {
          timeZone: "UTC",
          month: "short",
          day: "numeric",
          weekday: "short",
        }).format(anchor),
      ),
    );
    for (const [kind, label] of [
      ["automation", "自動実行"],
      ["workflow", "ワークフロー"],
    ]) {
      const runs = state.runs.filter(
        (r) =>
          dateJP(
            r.scheduled_for.startsWith("manual:")
              ? r.data.created_at
              : r.scheduled_for,
          ) === day &&
          r.data.definition.kind === kind &&
          matched(r),
      );
      const upcoming = state.definitions
        .filter(
          (d) =>
            d.enabled &&
            d.next_due &&
            d.data.kind === kind &&
            ["unfinished", "queued"].includes(filter),
        )
        .map((d) => {
          const period = { once: 0, daily: 86400000, weekly: 604800000 }[
            d.data.repeat
          ];
          let at = d.next_due;
          if (period) {
            const gap =
              new Date(day + "T00:00:00+09:00").getTime() - Date.parse(at);
            at = new Date(
              Date.parse(at) + Math.max(0, Math.ceil(gap / period)) * period,
            ).toISOString();
          }
          return { d, at };
        })
        .filter(
          ({ d, at }) =>
            dateJP(at) === day &&
            !state.runs.some(
              (r) => r.definition_id === d.id && r.scheduled_for === at,
            ),
        );
      const group = node("details");
      group.open = true;
      group.append(
        node("summary", `${label} ${runs.length + upcoming.length}`),
      );
      for (const r of runs) {
        const b = button(r.data.definition.title, () => openRun(r.id));
        b.className = "wf-run";
        b.append(
          node(
            "small",
            `${states[r.status]} · ${r.data.current}/${r.data.tasks.length}`,
          ),
          node(
            "small",
            r.data.next_work || r.data.stop_reason || "成果物を確認済み",
          ),
        );
        group.append(b);
      }
      for (const { d, at } of upcoming) {
        const card = node("div", undefined, "wf-upcoming");
        card.append(
          node("strong", d.data.title),
          node(
            "small",
            `${stamp(at)} · 予定${state.settings.stopped ? "（全体停止中）" : ""}`,
          ),
          node("small", "巡回時に Run を作成"),
        );
        group.append(card);
      }
      if (!runs.length && !upcoming.length)
        group.append(node("small", "予定なし"));
      el.append(group);
    }
    days.push(el);
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  }
  $("#calendar").replaceChildren(...days);
  $("#definitions").replaceChildren(
    ...state.definitions.map((d) => {
      const el = node("article", undefined, "wf-definition");
      el.append(
        node("h3", d.data.title),
        node(
          "p",
          `${d.enabled ? "実行許可済み" : "停止・下書き"} · v${d.revision} · ${{ once: "単発", daily: "毎日", weekly: "毎週" }[d.data.repeat]} · 次回 ${stamp(d.next_due)}`,
        ),
        node("p", d.data.purpose),
      );
      const row = node("div", undefined, "wf-row");
      if (d.enabled) {
        row.append(
          button("今後の定期実行を停止", async () => {
            await api({
              action: "schedule_stop",
              definition_id: d.id,
              revision: d.revision,
            });
            await load();
          }),
          button("手動実行", async () => {
            if (!manualKeys.has(d.id))
              manualKeys.set(d.id, crypto.randomUUID());
            const r = await api({
              action: "start",
              definition_id: d.id,
              revision: d.revision,
              request_id: manualKeys.get(d.id),
            });
            manualKeys.delete(d.id);
            await load();
            await openRun(r.id);
          }),
        );
      } else
        row.append(
          button("アーカイブ", async () => {
            if (
              !confirm(
                "定義をアーカイブします。既存の Run と履歴は保持します。",
              )
            )
              return;
            await api({
              action: "archive",
              definition_id: d.id,
              revision: d.revision,
            });
            await load();
          }),
          button("編集", () => openEditor(d)),
          button("内容を確認・実行を許可", async () => {
            const details = `${d.data.title}\n目的: ${d.data.purpose}\n完了条件: ${d.data.completion}\n許可範囲: ${d.data.permissions}\n工程:\n${d.data.tasks.map((t, i) => `${i + 1}. ${t.title} (${t.assignee === "dot" ? "dot" : "自分"}${t.gate ? "・確認ゲート" : ""})\n完了条件: ${t.completion}`).join("\n")}\nこの本人の仕事を実行可能にしますか？`;
            if (!confirm(details)) return;
            await api({
              action: "publish",
              definition_id: d.id,
              revision: d.revision,
              authorized: true,
            });
            await load();
          }),
        );
      el.append(row);
      return el;
    }),
  );
}
function taskEditor(
  t = { title: "", completion: "", assignee: "dot", gate: true },
) {
  const row = node("div", undefined, "wf-task");
  for (const [name, label, type] of [
    ["title", "工程名", "input"],
    ["completion", "工程の完了条件", "textarea"],
  ]) {
    const l = node("label", label),
      input = node(type);
    input.name = "task-" + name;
    input.required = true;
    input.maxLength = name === "title" ? 300 : 2000;
    input.value = t[name];
    l.append(input);
    row.append(l);
  }
  const l = node("label", "担当"),
    select = node("select");
  select.name = "task-assignee";
  for (const [v, text] of [
    ["dot", "dot"],
    ["self", "自分"],
  ]) {
    const o = node("option", text);
    o.value = v;
    select.append(o);
  }
  select.value = t.assignee;
  l.append(select);
  row.append(l);
  const check = node("label", "本人の確認ゲート", "wf-check"),
    input = node("input");
  input.type = "checkbox";
  input.name = "task-gate";
  input.checked = t.gate;
  check.prepend(input);
  row.append(
    check,
    button("工程を削除", () => row.remove()),
  );
  return row;
}
const localTime = (x) =>
  x
    ? new Date(new Date(x).getTime() + 9 * 3600000).toISOString().slice(0, 16)
    : "";
function openEditor(d = null) {
  editing = d;
  const form = $("#definition-form");
  form.reset();
  $("#editor-error").textContent = "";
  $("#editor-title").textContent = d ? "定義の新しい版を編集" : "定義を作成";
  if (d) {
    for (const [k, v] of Object.entries(d.data))
      if (form.elements[k])
        form.elements[k].value = ["start", "deadline"].includes(k)
          ? localTime(v)
          : v;
  } else form.elements.start.value = localTime(Date.now() + 3600000);
  $("#task-editor").replaceChildren(
    ...(d?.data.tasks || [undefined]).map(taskEditor),
  );
  $("#editor").showModal();
}
async function openRun(id) {
  const viewGeneration = ++runViewGeneration;
  const detail = await api(null, "?run_id=" + encodeURIComponent(id));
  if (viewGeneration !== runViewGeneration) return;
  viewing = detail.run;
  renderRun(detail);
  if (!$("#run-dialog").open) $("#run-dialog").showModal();
}
function renderRun(detail) {
  const r = detail.run,
    d = r.data,
    body = $("#run-detail");
  body.replaceChildren(
    node("h3", d.definition.title),
    node(
      "p",
      `${states[r.status]} · 定義 v${r.definition_revision} / Run v${r.revision}`,
    ),
    node("p", "目的：" + d.definition.purpose),
    node("p", "全体の完了条件：" + d.definition.completion),
    node("p", "許可範囲：" + d.definition.permissions),
    node("p", "期限：" + stamp(d.definition.deadline)),
    node("p", "次の作業：" + d.next_work),
    node("p", "停止理由：" + (d.stop_reason || "なし")),
  );
  const ol = node("ol");
  for (const t of d.tasks) {
    const li = node(
      "li",
      `${t.title} · ${t.assignee === "dot" ? "dot" : "自分"} · ${{ pending: "未着手", running: "進行中", review: "確認待ち", completed: "完了" }[t.status] || t.status}${t.gate ? " · 確認ゲート" : ""}`,
    );
    li.append(node("p", "完了条件：" + t.completion), node("p", t.result));
    for (const href of t.evidence || []) {
      const a = node("a", href);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a, node("br"));
    }
    ol.append(li);
  }
  body.append(ol);
  if (d.external)
    body.append(
      node(
        "pre",
        "外部作業参照（再起動せずこの参照で確認）\n" +
          JSON.stringify(d.external, null, 2),
      ),
    );
  $("#run-action").reset();
  $("#run-error").textContent = "";
  const task = d.tasks[d.current];
  if (r.status === "review") {
    const f = $("#run-action");
    f.elements.result.value = task.result;
    f.elements.evidence.value = task.evidence.join("\n");
  }
  const actions = [];
  if (!["completed", "cancelled"].includes(r.status)) {
    actions.push(["pause", "一時停止"], ["cancel", "今回を中止"]);
    if (["waiting", "paused"].includes(r.status))
      actions.push(["resume", "今回を再開"]);
    if (r.status === "review") actions.push(["approve", "確認して次へ"]);
    if (task?.assignee === "self" && ["queued", "waiting"].includes(r.status))
      actions.push(["self_complete", "自分の工程を完了"]);
  }
  $("#run-controls").replaceChildren(
    ...actions.map(([action, label]) =>
      button(
        label,
        async () => {
          if (
            action === "cancel" &&
            !confirm("今回を中止します。外部で完了した操作は取り消しません。")
          )
            return;
          const f = $("#run-action");
          await api({
            action,
            run_id: r.id,
            revision: r.revision,
            result: f.elements.result.value,
            evidence: f.elements.evidence.value
              .split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
            criteria_verified: f.elements.criteria_verified.checked,
            workflow_criteria_verified:
              f.elements.workflow_criteria_verified.checked,
          });
          await load();
          if ($("#run-dialog").open) await openRun(r.id);
        },
        "#run-error",
      ),
    ),
  );
  $("#run-history").replaceChildren(
    ...detail.history.map((h) => {
      const el = node("details");
      el.append(
        node(
          "summary",
          `${stamp(h.created_at)} · v${h.revision} · ${states[h.status] || h.status}`,
        ),
        node("pre", JSON.stringify(JSON.parse(h.snapshot), null, 2)),
      );
      return el;
    }),
  );
}
$("#definition-form").addEventListener("submit", (event) => {
  event.preventDefault();
  guard(async () => {
    const f = event.target,
      content = {};
    for (const k of [
      "title",
      "purpose",
      "completion",
      "permissions",
      "kind",
      "repeat",
    ])
      content[k] = f.elements[k].value;
    content.priority = Number(f.elements.priority.value);
    content.start = new Date(
      f.elements.start.value + ":00+09:00",
    ).toISOString();
    content.deadline = f.elements.deadline.value
      ? new Date(f.elements.deadline.value + ":00+09:00").toISOString()
      : null;
    content.tasks = [...$("#task-editor").children].map((row) => ({
      title: row.querySelector("[name=task-title]").value,
      completion: row.querySelector("[name=task-completion]").value,
      assignee: row.querySelector("[name=task-assignee]").value,
      gate: row.querySelector("[name=task-gate]").checked,
    }));
    await api({
      action: editing ? "edit" : "create",
      ...(editing
        ? { definition_id: editing.id, revision: editing.revision }
        : {}),
      content,
    });
    $("#editor").close();
    await load();
  }, "#editor-error");
});
$("#run-action").addEventListener("submit", (e) => e.preventDefault());
$("#new").onclick = () => openEditor();
$("#add-task").onclick = () => $("#task-editor").append(taskEditor());
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => $("#" + b.dataset.close).close();
$("#prev").onclick = () => shift(-1);
$("#next").onclick = () => shift(1);
$("#today").onclick = () => {
  selected = dateJP(Date.now());
  render();
};
$("#day").onchange = (e) => {
  if (e.target.value) {
    selected = e.target.value;
    render();
  }
};
$("#refresh").onclick = () => guard(load);
$("#save-interval").onclick = () =>
  guard(async () => {
    await api({
      action: "settings",
      revision: state.settings.revision,
      desired_interval: Number($("#interval").value),
    });
    await load();
  });
$("#global-stop").onclick = () =>
  guard(async () => {
    const cfg = state.settings;
    if (
      !confirm(
        cfg.stopped
          ? "全体停止を解除します。停止中の Run は個別に再開してください。"
          : "今後の実行と実行中の Run を停止します。外部の操作は取り消しません。",
      )
    )
      return;
    await api({
      action: cfg.stopped ? "resume_all" : "stop_all",
      revision: cfg.revision,
    });
    await load();
  });
$("#auth").onclick = () =>
  guard(async () => {
    if (signedIn) {
      await signOutUser();
      location.reload();
    } else {
      localStorage.setItem("works_pending_destination", "/workflow/");
      signIn("/tutor/");
    }
  });
watchAuth({
  onSignedIn: () => {
    signedIn = true;
    $("#auth").textContent = "ログアウト";
    $("#workspace").hidden = false;
    guard(load);
  },
  onSignedOut: (message) => {
    $("#workspace").hidden = true;
    $("#error").textContent =
      message || "Works にログインしてワークフローを管理します。";
  },
});

$("#run-dialog").addEventListener("close", () => {
  runViewGeneration++;
});
