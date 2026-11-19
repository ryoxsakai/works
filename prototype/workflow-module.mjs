import view from './workflow-view.html?raw';
import './workflow-native.css';
import {createWorkflowSteps} from './workflow-steps.mjs';
import {createWorkflowRoles} from './workflow-roles.mjs';
import {runTime,orderRuns,roleOf} from '../workflow/planning.mjs';
import {createWorkflowDialogs,assertWorkflowAck,safeWorkflowUrl,validWorkflowList,workflowActions} from './workflow-model.mjs';
export function mountWorkflow(root,context,{id,type,step}={}) {
let alive=true,stopped=false,needsRefresh=false,attempt=null,inputLocks=[],readFailed=false;
const lifecycle=new AbortController();context.metrics.mounts++;root.classList.add('workflow-native');root.innerHTML='<p><a class="external" href="/workflow/">従来のワークフロー画面へ ↗</a></p>'+view;
const dialogs=createWorkflowDialogs(root,{busy:()=>busy||stopped}),{showDialog,closeDialog,markDialogSaved}=dialogs;
const roles=createWorkflowRoles({root,api,guard,showDialog,closeDialog,markDialogSaved,changed:load});
root.addEventListener('click',event=>{if((busy||stopped)&&!event.target.closest('[data-workflow-recovery]')){event.preventDefault();event.stopImmediatePropagation();}}, {capture:true,signal:lifecycle.signal});
function recovery(){
  if(root.querySelector('[data-workflow-recovery]'))return;
  const panel=document.createElement('section');panel.dataset.workflowRecovery='';panel.setAttribute('role','alert');panel.innerHTML='<p>競合または保存結果が不明なため更新を停止しました。入力を保持し、自動再送しません。</p><button data-inspect>最新を読み取りで確認</button><button data-export>入力と操作参照を保存</button><button data-reset>入力を破棄して再読込</button><pre hidden></pre>';
  const dialog=[...root.querySelectorAll('dialog[open]')].at(-1);(dialog||root.querySelector('main')).prepend(panel);
  panel.querySelector('[data-inspect]').onclick=()=>guard(async()=>{const latest=await api();const pre=panel.querySelector('pre');pre.hidden=false;pre.textContent=JSON.stringify({latest,attempt},null,2);});
  panel.querySelector('[data-export]').onclick=()=>{const data={attempt,state,forms:[...root.querySelectorAll('form')].map(f=>({id:f.id,fields:[...f.querySelectorAll('input,textarea,select')].map(e=>({name:e.name,value:e.type==='checkbox'?e.checked:e.multiple?[...e.selectedOptions].map(o=>o.value):e.value}))}))};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='works-workflow-unsaved.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  panel.querySelector('[data-reset]').onclick=()=>guard(async()=>{if(!confirm('最新を読み直し、保存していない入力を破棄しますか？不明な操作は再送しません。'))return;const latest=await api();if(!validWorkflowList(latest))throw Error('一覧の応答を確認できません');dialogs.dispose();state=latest;stopped=false;needsRefresh=false;attempt=null;editing=viewing=null;readFailed=false;panel.remove();$('#workspace').hidden=false;render();});
}
const $ = (x) => root.querySelector(x);
const states = {
  planned: "計画のみ（未実行）",
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
  busy = false;
const workflowSteps = createWorkflowSteps({root, state: () => state, showDialog, closeDialog });

let runViewGeneration = 0;
let editorViewGeneration = 0;
let planningIndex = null,runInputBaseline='';
const runInputSnapshot=()=>JSON.stringify([...$('#run-action').elements].filter(e=>e.name).map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));
let activeFilter = "all",
  calendarView = "calendar";
const searchMatches = (d) =>
  !$("#workflow-search").value.trim() ||
  (d.title + " " + d.purpose)
    .toLocaleLowerCase()
    .includes($("#workflow-search").value.trim().toLocaleLowerCase());
const policySummary = (d) =>
  d.planning_policy?.enabled
    ? `今日から3日先の未着手工程の日付・担当を自動調整。追加候補：${d.planning_policy.role_ids.map((id) => state.roles?.find((r) => r.id === id)?.data.name || id).join("、") || "なし（元の担当のみ）"}。指示改稿：${d.planning_policy.revise_instructions ? "同じ目的・許可範囲・完了条件内で可" : "不可"}`
    : "未許可（毎回本人の採用が必要）";
const manualKeys = new Map();
async function api(body, query = "") {
  if (!alive) throw new DOMException('Workflow closed','AbortError');
  if(body&&!workflowActions.has(body.action))throw Error('Unsupported Workflow operation');
  if(body && (!state || stopped)) throw Error('更新を停止しています。最新状態を確認してください。');
  const sent=body?structuredClone(body):null;
  if(body&&!inputLocks.length){inputLocks=[...root.querySelectorAll('input,select,textarea')].map(e=>[e,e.dataset.savingDisabled===undefined?e.disabled:e.dataset.savingDisabled==='true']);for(const [e]of inputLocks)e.disabled=true;}
  try {
    const value=await context.request('/api/workflow'+query,{method:body?'POST':'GET',body:sent,signal:lifecycle.signal});
    if(!alive)throw new DOMException('Workflow closed','AbortError');
    if(body){assertWorkflowAck(sent,value);needsRefresh=true;attempt={body:sent,acknowledged:true,result:value};}
    return value;
  } catch(error) {
    if(alive&&!body)readFailed=true;
    if(alive&&body&&![400,413].includes(error.status)){stopped=true;attempt={body:sent,acknowledged:false};recovery();}
    throw error;
  }
}
async function guard(fn, target = '#error') {
  if(busy||!alive)return;
  busy=true;$('#workspace').setAttribute('aria-busy','true');$('#workflow-feedback').textContent='処理しています…';$(target).textContent='';
  try {await fn();if(!alive)return;needsRefresh=false;if(!stopped)attempt=null;}
  catch(error){if(!alive)return;if(needsRefresh||readFailed){stopped=true;recovery();}$(target).textContent=error.message;const d=[...root.querySelectorAll('dialog[open]')].at(-1);if(d){let e=d.querySelector('.wf-dialog-error');if(!e){e=node('p','');e.className='wf-dialog-error';e.setAttribute('role','alert');d.append(e);}e.textContent=error.message;}}
  finally{busy=false;if(alive){for(const [e,disabled]of inputLocks)if(e.isConnected)e.disabled=disabled;inputLocks=[];$('#workspace').removeAttribute('aria-busy');$('#workflow-feedback').textContent='';}}
}
async function load() {
  const latest = await api();
  if(!validWorkflowList(latest))throw Error("ワークフロー一覧の応答を確認できません。");
  state=latest;$('#workspace').hidden=false;render();
  $("#coverage").textContent =
    (state.next_offset
      ? "最新500件の Run を表示しています。古い実行は API の offset で確認できます。 "
      : "") +
    (state.definitions_truncated ? "定義は先頭200件を表示しています。" : "") +
    (state.staged_plans?.truncated
      ? " 将来計画は先頭200件です。API stage_offset で続きを取得できます。"
      : "");
}
function matched(r) {
  if (!searchMatches(r.data.definition)) return false;
  if ($("#role-filter").value && roleOf(r)?.id !== $("#role-filter").value)
    return false;
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
  workflowSteps.render();
  roles.renderRoles(state);
  const roleFilter = $("#role-filter"),
    previousRole = roleFilter.value;
  roleFilter.replaceChildren(node("option", "担当すべて"));
  roleFilter.firstChild.value = "";
  for (const r of state.roles || []) {
    const o = node(
      "option",
      r.data.icon + " " + r.data.name + (r.archived ? "（アーカイブ）" : ""),
    );
    o.value = r.id;
    roleFilter.append(o);
  }
  roleFilter.value = previousRole;

  $("#reset-filters").hidden = !($("#workflow-search").value.trim() || previousRole || filter !== "unfinished" || activeFilter !== "all");
  $("#filter-summary").textContent = `${states[filter]}${previousRole?"・担当指定":""}`;
  $("#day").value = selected;
  const active = state.runs.filter(
    (r) => !["completed", "cancelled"].includes(r.status),
  );
  const visibleActive = active.filter(
    (r) =>
      (activeFilter === "all" || r.status === activeFilter),
  );
  $("#active-count").textContent =
    `${visibleActive.length}件表示 / 未完了 ${active.length}件`;
  visibleActive.sort(orderRuns);
  $("#active-runs").replaceChildren(
    ...(visibleActive.length
      ? visibleActive.map((r) => runCard(r))
      : [
          node(
            "p",
            "条件に合う未完了の実行はありません。確認事項の絞り込みを変更できます。",
            "wf-empty",
          ),
        ]),
  );
  const cfg = state.settings;
  $("#rolling-apply").disabled = !!cfg.stopped;
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
    ...Object.entries(states)
      .filter(([k]) => k !== "planned")
      .map(([k, v]) => {
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
  const days = [];
  for (let i = 0; i < 4; i++) {
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
    {
      const label = "時刻順";
      const runs = state.runs
        .filter((r) => runTime(r) && dateJP(runTime(r)) === day && matched(r))
        .sort(orderRuns);
      const upcoming = state.definitions
        .filter(
          (d) =>
            searchMatches(d.data) &&
            (!$("#role-filter").value ||
              d.data.tasks.some(
                (t) => t.role_id === $("#role-filter").value,
              )) &&
            d.enabled &&
            d.next_due &&
            ["unfinished", "queued"].includes(filter),
        )
        .flatMap((d) => {
          const period = {
            once: 0,
            hourly: d.data.interval_hours * 3600000,
            daily: 86400000,
            weekly: 604800000,
          }[d.data.repeat];
          let at = d.next_due;
          if (period) {
            const gap =
              new Date(day + "T00:00:00+09:00").getTime() - Date.parse(at);
            at = new Date(
              Date.parse(at) + Math.max(0, Math.ceil(gap / period)) * period,
            ).toISOString();
          }
          const slots = [{ d, at }];
          if (d.data.repeat === "hourly") {
            for (
              let next = Date.parse(at) + period;
              dateJP(next) === day && slots.length < 24;
              next += period
            )
              slots.push({ d, at: new Date(next).toISOString() });
          }
          return slots;
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
      const future = state.runs
        .flatMap((r) =>
          r.data.tasks
            .map((t, i) => ({ r, t, i }))
            .filter(
              ({ t, i }) =>
                i > r.data.current &&
                t.status === "pending" &&
                t.planned_for &&
                dateJP(t.planned_for) === day,
            )
            .map(({ t, i }) => ({
              ...r,
              status: "queued",
              preview_task_index: i,
              data: { ...r.data, current: i, plan: t.plan || null },
            })),
        )
        .filter(matched);
      const stagedUpcoming = (state.staged_plans?.plans || [])
        .filter((p) => p.current)
        .flatMap((p) =>
          Object.entries(p.data.plans || {}).map(([index, plan]) => ({
            d: state.definitions.find((d) => d.id === p.definition_id),
            at: plan.planned_for,
            scheduled: p.scheduled_for,
            stageTaskIndex: Number(index),
            plan,
          })),
        )
        .filter(
          (p) =>
            p.d &&
            p.at &&
            dateJP(p.at) === day &&
            searchMatches(p.d.data) &&
            (!$("#role-filter").value ||
              p.plan.role_id === $("#role-filter").value) &&
            ["unfinished", "queued"].includes(filter),
        );
      const entries = [
        ...runs.map((r) => ({ r, at: runTime(r) })),
        ...future.map((r) => ({ r, at: runTime(r) })),
        ...upcoming.filter(
          (p) =>
            !state.staged_plans?.plans.some(
              (s) =>
                s.current &&
                s.definition_id === p.d.id &&
                s.scheduled_for === p.at &&
                s.data.plans?.[0],
            ),
        ),
        ...stagedUpcoming,
      ];
      group.firstChild.textContent = `${label} ${entries.length}`;
      entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      for (const entry of entries) {
        if (entry.r) {
          group.append(runCard(entry.r));
          continue;
        }
        const { d, at } = entry,
          card = node("div", undefined, "wf-upcoming");
        card.append(
          node("strong", d.data.title),
          node(
            "small",
            `${stamp(at)} · 許可済み定義の予定${state.settings.stopped ? "（全体停止中）" : ""}`,
          ),
          node("small", "巡回時に Run を作成"),
        );
        if (entry.stageTaskIndex !== undefined)
          card.append(
            node(
              "strong",
              `工程${entry.stageTaskIndex + 1}：${d.data.tasks[entry.stageTaskIndex].title}（事前計画）`,
            ),
          );
        if (state.staged_plans) {
          const edit = node("button", "予定工程を調整");
          edit.onclick = () =>
            openFuture(
              d.id,
              entry.scheduled || at,
              entry.stageTaskIndex ?? null,
            ).catch((e) => ($("#error").textContent = e.message));
          card.append(edit);
        }
        const role =
          entry.plan?.role_snapshot || d.data.tasks[0]?.role_snapshot;
        if (role)
          card.append(
            node(
              "span",
              role.icon + " " + role.name,
              "wf-role role-" + role.color,
            ),
          );
        group.append(card);
      }
      if (!entries.length) group.append(node("small", "予定なし"));
      el.append(group);
    }
    days.push(el);
    anchor.setUTCDate(anchor.getUTCDate() + 1);
  }
  $("#calendar").replaceChildren(...days);
  $("#definitions").replaceChildren(
    ...state.definitions
      .map((d) => {
        const el = node("article", undefined, "wf-definition");
        el.append(
          node("h3", d.data.title),
          node(
            "p",
            `${d.enabled ? "実行許可済み" : "停止・下書き"} · v${d.revision} · ${d.data.repeat === "hourly" ? `${d.data.interval_hours}時間ごと` : { once: "単発", daily: "毎日", weekly: "毎週" }[d.data.repeat]} · 次回 ${stamp(d.next_due)}`,
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
              const generation = runViewGeneration;
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
              if (generation === runViewGeneration) await openRun(r.id);
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
              const details = `${d.data.title}\n目的: ${d.data.purpose}\n完了条件: ${d.data.completion}\n許可範囲: ${d.data.permissions}\n工程:\n${d.data.tasks.map((t, i) => `${i + 1}. ${t.title} (${t.assignee === "dot" ? "dot" : "自分"}・担当 ${t.role_snapshot?.name || "なし"}${t.fixed ? "・本人固定" : ""}${t.gate ? "・確認ゲート" : ""})\n完了条件: ${t.completion}`).join("\n")}\n交通整理の事前許可: ${policySummary(d.data)}\nこの本人の仕事を実行可能にしますか？`;
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
  if(!state.definitions.length) $("#definitions").append(node("p","定義はまだありません。カンバンからワークフローを作成してください。","wf-empty"));
}
function runCard(r) {
  const b = node("button", r.data.definition.title);
  b.dataset.runId = r.id;
  b.type = "button";
  b.onclick = () =>
    openRun(r.id).catch((e) => ($("#error").textContent = e.message));
  b.className = "wf-run wf-active-card";
  b.dataset.status = r.status;
  if (r.preview_task_index !== undefined)
    b.append(
      node(
        "strong",
        `工程${r.preview_task_index + 1}：${r.data.tasks[r.preview_task_index].title}（前工程待ち）`,
      ),
    );
  const done = r.data.tasks.filter((t) => t.status === "completed").length;
  const status = node("span", states[r.status] || r.status, "wf-status");
  b.prepend(status);
  const role = roleOf(r);
  if (role)
    b.append(
      node("span", role.icon + " " + role.name, "wf-role role-" + role.color),
    );
  if (
    r.data.definition.deadline &&
    Date.parse(r.data.definition.deadline) < Date.now() &&
    !["completed", "cancelled"].includes(r.status)
  )
    b.append(node("strong", "期限超過：" + stamp(r.data.definition.deadline)));
  const time = runTime(r);
  b.append(
    node(
      "small",
      time
        ? stamp(time) +
            (dateJP(time) < dateJP(Date.now()) &&
            !["completed", "cancelled"].includes(r.status)
              ? " ・期限超過/過去予定"
              : "")
        : "日付未定",
    ),
  );
  const progress = node("progress");
  progress.max = Math.max(1, r.data.tasks.length);
  progress.value = done;
  progress.setAttribute(
    "aria-label",
    `完了 ${done} / ${r.data.tasks.length}工程`,
  );
  b.append(
    node(
      "small",
      `${done} / ${r.data.tasks.length}工程完了 · 開始 ${stamp(r.data.created_at || r.scheduled_for)}`,
    ),
    progress,
    node(
      "small",
      r.data.stop_reason || r.data.next_work || "詳細を開いて次の作業を確認",
    ),
  );
  return b;
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
  const roleLabel = node("label", "担当（役割）"),
    roleSelect = node("select");
  roleSelect.name = "task-role";
  roleSelect.append(node("option", "担当なし"));
  roleSelect.firstChild.value = "";
  for (const role of state.roles || []) {
    if (role.archived && role.id !== t.role_id) continue;
    const option = node("option", role.data.icon + " " + role.data.name);
    option.value = role.id;
    roleSelect.append(option);
  }
  roleSelect.value = t.role_id || "";
  roleLabel.append(roleSelect);
  row.append(roleLabel);
  const fixedLabel = node("label", "本人固定（dotの配分変更不可）", "wf-check"),
    fixed = node("input");
  fixed.type = "checkbox";
  fixed.name = "task-fixed";
  fixed.checked = t.fixed === true;
  fixedLabel.prepend(fixed);
  row.append(fixedLabel);
  const refsLabel = node(
      "label",
      "Wiki参考URL（1行1件・実行許可にはなりません）",
    ),
    refs = node("textarea");
  refs.name = "task-wiki";
  refs.value = (t.wiki_refs || []).join("\n");
  refsLabel.append(refs);
  row.append(refsLabel);
  const l = node("label", "実行者"),
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
function unlockDefinitionForm() {
  for (const el of $("#definition-form").querySelectorAll("[data-saving-disabled]")) {
    el.disabled = el.dataset.savingDisabled === "true";
    delete el.dataset.savingDisabled;
  }
}
function openEditor(d = null) {
  editorViewGeneration++;
  unlockDefinitionForm();
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
  form.elements.planning_enabled.checked =
    d?.data.planning_policy?.enabled === true;
  form.elements.planning_instructions.checked =
    d?.data.planning_policy?.revise_instructions === true;
  const allowed = form.elements.planning_roles;
  allowed.replaceChildren();
  for (const role of state.roles || [])
    if (!role.archived) {
      const o = node("option", role.data.name);
      o.value = role.id;
      o.selected =
        d?.data.planning_policy?.role_ids?.includes(role.id) || false;
      allowed.append(o);
    }
  updateHoursInput();
  $("#task-editor").replaceChildren(
    ...(d?.data.tasks || [undefined]).map(taskEditor),
  );
  showDialog($("#editor"));
}
async function openRun(id) {
  if (viewing?.id !== id) planningIndex = null;
  const viewGeneration = ++runViewGeneration;
  const detail = await api(null, "?run_id=" + encodeURIComponent(id));
  if(detail?.run?.id!==id||!Array.isArray(detail.history))throw Error("実行対象の応答を確認できません。");
  if (viewGeneration !== runViewGeneration) return;
  viewing = detail.run;
  renderRun(detail);
  if (!$("#run-dialog").open)
    await showDialog(
      $("#run-dialog"),
      () => viewGeneration === runViewGeneration && viewing?.id === id,
    );
}
async function futureDetail(id, scheduled) {
  const { definition: d } = await api(
    null,
    "?definition_id=" + encodeURIComponent(id),
  );
  const known = state.staged_plans?.plans.find(
    (p) => p.definition_id === id && p.scheduled_for === scheduled,
  );
  const stored = known
    ? await api(null, "?stage_id=" + encodeURIComponent(known.id))
    : null;
  const plans = known?.current ? stored?.staged_plan.data.plans || {} : {},
    suggestions = known?.current
      ? stored?.staged_plan.data.suggestions || {}
      : {};
  const tasks = d.data.tasks.map((t, i) => ({
    ...t,
    ...(plans[i]
      ? {
          role_id: plans[i].role_id,
          role_snapshot: plans[i].role_snapshot,
          instruction: plans[i].instruction,
          planned_for: plans[i].planned_for,
          plan: plans[i],
        }
      : {}),
    plan_suggestion: suggestions[i],
    status: "pending",
    evidence: [],
    result: "",
  }));
  return {
    run: {
      id: "future:" + id + "@" + scheduled,
      status: "planned",
      revision: d.revision,
      definition_revision: d.revision,
      scheduled_for: scheduled,
      future: {
        definition_id: id,
        definition_revision: d.revision,
        scheduled_for: scheduled,
        stage_revision: stored?.staged_plan.revision || 0,
      },
      data: {
        current: 0,
        definition: d.data,
        tasks,
        next_work: "将来の予定案。Runは未作成です",
        stop_reason: "",
        external: null,
      },
    },
    history: stored?.history || [],
  };
}
async function openFuture(id, scheduled, index = null) {
  const generation = ++runViewGeneration;
  planningIndex = index;
  const detail = await futureDetail(id, scheduled);
  if (generation !== runViewGeneration) return;
  viewing = detail.run;
  renderRun(detail);
  await showDialog(
    $("#run-dialog"),
    () => generation === runViewGeneration && viewing?.id === detail.run.id,
  );
}
async function refreshVisibleRun(id, generation) {
  const current = () =>
    $("#run-dialog").open &&
    viewing?.id === id &&
    runViewGeneration === generation;
  if (!current()) return;
  const detail = viewing.future
    ? await futureDetail(
        viewing.future.definition_id,
        viewing.future.scheduled_for,
      )
    : await api(null, "?run_id=" + encodeURIComponent(id));
  if (!current()) return;
  viewing = detail.run;
  renderRun(detail);
}
function renderRun(detail) {
  const r = detail.run,
    d = r.data,
    body = $("#run-detail");
  body.replaceChildren(
    node("h3", d.definition.title),
    node(
      "p",
      `${states[r.status]} · 定義 v${r.definition_revision} / ${r.future ? (r.future.stage_revision ? "予定計画 v" + r.future.stage_revision : "予定計画は未保存") : "Run v" + r.revision}`,
    ),
    node("p", "目的：" + d.definition.purpose),
    node("p", "全体の完了条件：" + d.definition.completion),
    node("p", "許可範囲：" + d.definition.permissions),
    node("p", "期限：" + stamp(d.definition.deadline)),
    node("p", "次の作業：" + d.next_work),
    node("p", "停止理由：" + (d.stop_reason || "なし")),
  );
  $("#run-action").hidden = !!r.future;
  $("#run-dialog h2").textContent = r.future
    ? "将来予定の交通整理（実行前）"
    : "今回の実行";
  const task = d.tasks[d.current];
  const editable = d.tasks
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => i >= d.current && !t.fixed);
  if (editable.length && !["completed", "cancelled"].includes(r.status)) {
    const index = editable.some((x) => x.i === planningIndex)
      ? planningIndex
      : editable[0].i;
    const planTask = d.tasks[index],
      planning = node("details");
    planning.append(node("summary", "配分案・未着手指示の改稿"));
    planning.append(
      node(
        "p",
        d.definition.planning_policy?.enabled
          ? "dotの交通整理は事前承認済みです。指定担当・今日から3日先・未着手工程の範囲内で予定を調整できます。実行許可や実行中指示は変わりません。"
          : "提案は実行指示を変えません。交通整理が未承認のため本人の採用が必要です。未来の未着手工程も選べます。",
      ),
    );
    let planningChanged=false;
    const targetLabel = node("label", "計画する工程"),
      target = node("select");
    target.id = "planning-task-index";
    for (const { t, i } of editable) {
      const o = node(
        "option",
        `${i + 1}. ${t.title}${i > d.current ? "（前工程待ち）" : ""}`,
      );
      o.value = i;
      target.append(o);
    }
    target.value = index;
    targetLabel.append(target);
    planning.append(targetLabel);
    target.onchange = () => {
      if((planningChanged||runInputSnapshot()!==runInputBaseline)&&!confirm("未保存の計画入力を破棄して工程を切り替えますか？")){target.value=index;return;}
      planningIndex = Number(target.value);
      renderRun(detail);
      const section = $("#planning-task-index").closest("details");
      section.open = true;
      $("#planning-task-index").focus();
    };
    const fields = {},
      proposal =
        planTask.plan_suggestion ||
        planTask.plan ||
        (index === d.current ? d.plan_suggestion || d.plan : null) ||
        {};
    for (const [key, label, type] of [
      ["role_id", "担当", "select"],
      ["planned_for", "予定（日本時間）", "input"],
      ["instruction", "指示案", "textarea"],
      ["rationale", "理由・優先順位・期限・依存の確認", "textarea"],
    ]) {
      const l = node("label", label),
        input = node(type);
      fields[key] = input;
      input.addEventListener("input",()=>{planningChanged=true;});
      if (key === "role_id") {
        const none = node("option", "担当なし");
        none.value = "";
        input.append(none);
        for (const role of state.roles || [])
          if (!role.archived) {
            const o = node("option", role.data.name);
            o.value = role.id;
            input.append(o);
          }
      }
      if (key === "planned_for") input.type = "datetime-local";
      input.value =
        key === "planned_for"
          ? localTime(proposal[key])
          : proposal[key] ||
            (key === "instruction"
              ? planTask.instruction || planTask.title
              : key === "role_id"
                ? planTask.role_id || ""
                : "");
      l.append(input);
      planning.append(l);
    }
    const inputPlan = () => {
      const plan = Object.fromEntries(
        Object.entries(fields).map(([k, input]) => [k, input.value]),
      );
      return {
        ...plan,
        task_index: index,
        role_id: plan.role_id || null,
        planned_for: plan.planned_for
          ? new Date(plan.planned_for + ":00+09:00").toISOString()
          : null,
      };
    };
    const mutate = async (action) => {
      if(runInputSnapshot()!==runInputBaseline&&!confirm("未保存の結果・確認入力を破棄して計画を保存しますか？"))return;
      const generation = runViewGeneration;
      await api(
        r.future
          ? {
              action: "stage_plan",
              ...r.future,
              mode: action === "plan_suggest" ? "suggest" : "apply",
              plan: inputPlan(),
            }
          : { action, run_id: r.id, revision: r.revision, plan: inputPlan() },
      );
      await load();
      await refreshVisibleRun(r.id, generation);
    };
    planning.append(
      button("配分案を保存", () => mutate("plan_suggest"), "#run-error"),
    );
    const canChange =
      planTask.status === "pending" &&
      (r.future || index > d.current || r.status === "queued");
    if (d.definition.planning_policy?.enabled && canChange)
      planning.append(
        button("承認範囲内で反映", () => mutate("plan_update"), "#run-error"),
      );
    const suggestion =
      planTask.plan_suggestion ||
      (index === d.current ? d.plan_suggestion : null);
    if (suggestion) {
      planning.append(node("pre", JSON.stringify(suggestion, null, 2)));
      if (canChange)
        planning.append(
          button(
            "この案を確認・採用",
            async () => {
              if (
                !confirm(
                  "表示中の案を選択工程へ採用します。実行者・許可範囲・確認ゲートは維持されます。",
                )
              )
                return;
              const generation = runViewGeneration;
              await api(
                r.future
                  ? {
                      action: "stage_plan",
                      ...r.future,
                      mode: "apply",
                      plan: suggestion,
                      authorized: true,
                    }
                  : {
                      action: "plan_apply",
                      run_id: r.id,
                      revision: r.revision,
                      task_index: index,
                      authorized: true,
                    },
              );
              await load();
              await refreshVisibleRun(r.id, generation);
            },
            "#run-error",
          ),
        );
    }
    body.append(planning);
  }
  const ol = node("ol");
  for (const t of d.tasks) {
    const li = node(
      "li",
      `${t.title} · ${t.assignee === "dot" ? "dot" : "自分"} · ${{ pending: "未着手", running: "進行中", review: "確認待ち", completed: "完了" }[t.status] || t.status}${t.gate ? " · 確認ゲート" : ""}`,
    );
    li.append(node("p", "完了条件：" + t.completion), node("p", t.result));
    if (t.role_snapshot)
      li.append(
        node(
          "span",
          t.role_snapshot.icon + " " + t.role_snapshot.name,
          "wf-role role-" + t.role_snapshot.color,
        ),
      );
    if (t.fixed) li.append(node("p", "本人固定"));
    if (t.instruction) li.append(node("p", "採用済み指示：" + t.instruction));
    if (t.planned_for)
      li.append(node("p", "工程予定：" + stamp(t.planned_for)));
    for (const href of t.wiki_refs || []) {
      const a = node("a", "Wiki参考資料（権限ではありません）");
      if(!safeWorkflowUrl(href)){li.append(node("p",href));continue;}
      a.className="external";
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a);
    }
    for (const href of t.evidence || []) {
      const a = node("a", href);
      if(!safeWorkflowUrl(href)){li.append(node("p",href));continue;}
      a.className="external";
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
  if (r.status === "review") {
    const f = $("#run-action");
    f.elements.result.value = task.result;
    f.elements.evidence.value = task.evidence.join("\n");
  }
  const actions = [];
  if (!r.future && !["completed", "cancelled"].includes(r.status)) {
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
          const generation = runViewGeneration;
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
          await refreshVisibleRun(r.id, generation);
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
  runInputBaseline=runInputSnapshot();
  markDialogSaved($("#run-dialog"));
}
function updateHoursInput() {
  const f = $("#definition-form"),
    hourly = f.elements.repeat.value === "hourly";
  $("#hours-label").hidden = !hourly;
  f.elements.interval_hours.disabled = !hourly;
  f.elements.interval_hours.required = hourly;
}
$("#definition-form").elements.repeat.addEventListener(
  "change",
  updateHoursInput,
);
$("#definition-form").addEventListener("submit", (event) => {
  event.preventDefault();
  guard(async () => {
    const f = event.target,
      generation = editorViewGeneration,
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
    if (content.repeat === "hourly")
      content.interval_hours = Number(f.elements.interval_hours.value);
    content.priority = Number(f.elements.priority.value);
    content.start = new Date(
      f.elements.start.value + ":00+09:00",
    ).toISOString();
    content.deadline = f.elements.deadline.value
      ? new Date(f.elements.deadline.value + ":00+09:00").toISOString()
      : null;
    content.planning_policy = {
      enabled: f.elements.planning_enabled.checked,
      revise_instructions: f.elements.planning_instructions.checked,
      role_ids: [...f.elements.planning_roles.selectedOptions].map(
        (o) => o.value,
      ),
    };
    content.tasks = [...$("#task-editor").children].map((row) => ({
      title: row.querySelector("[name=task-title]").value,
      completion: row.querySelector("[name=task-completion]").value,
      assignee: row.querySelector("[name=task-assignee]").value,
      gate: row.querySelector("[name=task-gate]").checked,
      role_id: row.querySelector("[name=task-role]").value || null,
      fixed: row.querySelector("[name=task-fixed]").checked,
      wiki_refs: row
        .querySelector("[name=task-wiki]")
        .value.split(/\n/)
        .filter(Boolean),
    }));
    for (const el of f.querySelectorAll("input,select,textarea,button:not([data-close])")) {
      el.dataset.savingDisabled = String(el.disabled);
      el.disabled = true;
    }
    try {
      await api({
        action: editing ? "edit" : "create",
        ...(editing
          ? { definition_id: editing.id, revision: editing.revision }
          : {}),
        content,
      });
      try {
        await load();
      } catch {
        stopped=true;recovery();
        $("#error").textContent = "下書きは保存しましたが、一覧を取得できませんでした。「更新」で確認してください。再作成は不要です。";
        return;
      }
      if (generation === editorViewGeneration && $("#editor").open) {
        markDialogSaved($("#editor"));
        closeDialog($("#editor"));
      }
    } finally {
      unlockDefinitionForm();
    }
  }, "#editor-error");
});
$("#run-action").addEventListener("submit", (e) => e.preventDefault());
$("#new").onclick = () => openEditor();
$("#add-task").onclick = () => $("#task-editor").append(taskEditor());
for (const b of root.querySelectorAll("[data-close]"))
  b.onclick = () => closeDialog($("#" + b.dataset.close));
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
    markDialogSaved($("#settings-dialog"));
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
$("#run-dialog").addEventListener("close", () => {
  runViewGeneration++;
});

$("#workflow-search").addEventListener("input", () => {
  if (state) render();
});
$("#active-filters").addEventListener("click", (event) => {
  const b = event.target.closest("[data-active]");
  if (!b) return;
  activeFilter = b.dataset.active;
  for (const item of $("#active-filters").querySelectorAll("button"))
    item.setAttribute("aria-pressed", String(item === b));
  if (state) render();
});
$("#calendar-view").addEventListener("click", (event) => {
  const b = event.target.closest("[data-view]");
  if (!b) return;
  calendarView = b.dataset.view;
  $("#calendar").classList.toggle("wf-agenda", calendarView === "agenda");
  for (const item of $("#calendar-view").querySelectorAll("button"))
    item.setAttribute("aria-pressed", String(item === b));
});

$("#reset-filters").onclick = () => {
  $("#workflow-search").value = $("#role-filter").value = "";
  filter = "unfinished";
  activeFilter = "all";
  for (const item of $("#active-filters").querySelectorAll("button"))
    item.setAttribute("aria-pressed", String(item.dataset.active === "all"));
  render();
  $("#workflow-search").focus();
};
$("#role-filter").onchange = render;

async function rolling(action) {
  const candidates = state.runs
    .filter(
      (r) =>
        r.data.definition.planning_policy?.enabled &&
        ["queued", "running", "review"].includes(r.status),
    )
    .map((r) => ({
      priority: r.data.definition.priority,
      deadline: r.data.definition.deadline,
      target: { run_id: r.id, revision: r.revision },
    }));
  if (state.staged_plans)
    for (const d of state.definitions.filter(
      (d) => d.enabled && d.next_due && d.data.planning_policy?.enabled,
    )) {
      const period = {
          once: 0,
          hourly: d.data.interval_hours * 3600000,
          daily: 86400000,
          weekly: 604800000,
        }[d.data.repeat],
        end = Date.parse(dateJP(Date.now()) + "T00:00:00+09:00") + 4 * 86400000;
      let at = Date.parse(d.next_due);
      if (period)
        at += Math.max(0, Math.ceil((Date.now() - at) / period)) * period;
      for (
        let count = 0;
        at >= Date.now() && at < end && count < 96;
        count++, at += period
      ) {
        const scheduled = new Date(at).toISOString();
        if (
          !state.runs.some(
            (r) => r.definition_id === d.id && r.scheduled_for === scheduled,
          )
        )
          candidates.push({
            priority: d.data.priority,
            deadline: d.data.deadline,
            target: {
              definition_id: d.id,
              revision: d.revision,
              scheduled_for: scheduled,
              stage_revision:
                state.staged_plans.plans.find(
                  (p) =>
                    p.definition_id === d.id && p.scheduled_for === scheduled,
                )?.revision || 0,
            },
          });
        if (!period) break;
      }
    }
  const targets = candidates
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        (Date.parse(a.deadline) || Infinity) -
          (Date.parse(b.deadline) || Infinity),
    )
    .slice(0, 20)
    .map((x) => x.target);
  if (!targets.length) {
    $("#planning-status").textContent =
      "交通整理を事前承認した未完了Runはありません。既存Runの許可は変わりません。";
    return;
  }
  const result = await api({ action, targets });
  $("#planning-status").textContent =
    `対象${targets.length}件${candidates.length > 20 ? "（先頭20件・続きを再計算してください）" : ""} / ${result.mode === "applied" ? "配分を更新" : "未反映の配分案"}：${result.mode === "applied" ? (result.updated || []).reduce((n, x) => n + x.task_indexes.length, 0) : result.plans.length}工程 / ${result.blocked.length}工程は期限・固定予定等の確認が必要${result.conflicts?.length ? " / 競合あり。読み直してください" : ""}`;
  $("#planning-preview").replaceChildren(
    ...result.plans.map((x) =>
      node(
        "p",
        `${state.runs.find((r) => r.id === x.run_id)?.data.definition.title || state.definitions.find((d) => x.run_id.startsWith("future:" + d.id + "@"))?.data.title || "将来予定"} / 工程${x.plan.task_index + 1} / ${stamp(x.plan.planned_for)} / ${state.roles?.find((r) => r.id === x.plan.role_id)?.data.name || "担当なし"}`,
      ),
    ),
  );
  if (action === "rolling_apply") await load();
}
$("#rolling-preview").onclick = () => guard(() => rolling("rolling_preview"));
$("#rolling-apply").onclick = () => guard(() => rolling("rolling_apply"));

$("#settings-dialog").addEventListener("close", () => {
  if (state) $("#interval").value = state.settings.desired_interval;
});

const unload=event=>{if(busy||stopped||dialogs.dirty()){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',unload,{signal:lifecycle.signal});
guard(async()=>{await load();if(!alive)return;const requested={roles:1,board:2,checks:3}[step];if(requested)workflowSteps.select(requested,{focus:false});if(id&&type==='roles'){const role=state.roles?.find(r=>r.id===id);if(role&&!role.archived){workflowSteps.select(1,{focus:false});roles.open(role);}}else if(id&&type==='definitions'){const d=state.definitions.find(d=>d.id===id);if(d){await showDialog($('#definitions-dialog'));if(!d.enabled)openEditor(d);}}else if(id&&type==='runs')await openRun(id);});
return {beforeHistoryLeave(){const open=[...root.querySelectorAll('dialog[open]')].at(-1);if(open){if(!busy&&!stopped)closeDialog(open);return false;}return true;},get dirty(){return busy||stopped||dialogs.dirty();},canLeave(){return !busy&&(!(stopped||dialogs.dirty())||confirm('未保存または保存結果未確認の入力を破棄して移動しますか？'));},unmount(){alive=false;lifecycle.abort();dialogs.dispose();state=viewing=editing=attempt=null;root.replaceChildren();context.metrics.unmounts++;}};
}
