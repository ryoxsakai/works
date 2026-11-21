import { defaultPeriodProfiles, PERIOD_MODES, readPeriodProfiles, SCHOOL_PERIOD_NAMES } from "../shared/tutor-period-display.mjs";

const COMMON = "common";
const MAX_PERIODS = 48;

export function createPeriodSettings({ panel, request, getCalendars, onSaved }) {
  const byId = id => panel.querySelector("#" + id);
  const picker = byId("period-school");
  const editor = byId("period-profiles-form");
  const mode = byId("period-display-mode");
  const schoolFields = byId("period-school-fields");
  const commonFields = byId("period-common-fields");
  const choices = byId("period-calendar-choices");
  const entries = byId("period-school-entries");
  const add = byId("period-school-add");
  const submit = byId("period-profiles-save");
  const reset = byId("period-profiles-reset");
  const status = byId("period-profiles-status");
  const error = byId("period-profiles-error");
  const loadLatest = byId("period-profiles-reload");
  let saved = defaultPeriodProfiles();
  let draft = structuredClone(saved);
  let loaded = false;
  let working = false;
  let needsRefresh = false;

  function school() { return draft.schools[picker.value]; }
  function dirty() { return JSON.stringify(draft) !== JSON.stringify(saved); }
  function notice(message = "", isError = false) {
    error.textContent = isError ? message : "";
    error.hidden = !isError;
    status.textContent = isError ? "" : message;
  }
  function updateCommands() {
    editor.setAttribute("aria-busy", String(working));
    for (const node of [picker, mode, schoolFields, loadLatest]) node.disabled = working || !loaded;
    add.disabled = working || !loaded || !school() || school().periods.length >= MAX_PERIODS;
    submit.disabled = working || !loaded || needsRefresh || !dirty();
    reset.disabled = working || !loaded || !dirty();
  }

  function field(label, input) {
    const wrapper = document.createElement("label");
    const caption = document.createElement("span");
    caption.textContent = label;
    wrapper.append(caption, input);
    return wrapper;
  }

  function renderEntries() {
    const active = school();
    entries.replaceChildren();
    if (!active.periods.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "時限は未登録です。設定するまでは実際の時刻が表示されます。";
      entries.append(empty);
    }
    active.periods.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "period-school-row";
      const label = document.createElement("input");
      label.type = "text";
      label.dataset.field = "label";
      label.value = entry.label;
      label.maxLength = 40;
      label.placeholder = "例：S限";
      label.required = true;
      const start = document.createElement("input");
      start.type = "time";
      start.dataset.field = "start_time";
      start.value = entry.start_time;
      start.required = true;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-outline";
      remove.textContent = "削除";
      remove.setAttribute("aria-label", `${i + 1}行目の時限を削除`);
      remove.addEventListener("click", () => {
        active.periods.splice(i, 1);
        renderEntries();
        updateCommands();
        (entries.querySelectorAll('[data-field="label"]')[i] || add).focus();
      });
      row.append(field("時限名", label), field("開始時刻", start), remove);
      for (const input of [label, start]) input.addEventListener("input", () => {
        entry[input.dataset.field] = input.value;
        updateCommands();
      });
      entries.append(row);
    });
  }

  function renderCalendars() {
    const active = school();
    choices.replaceChildren();
    if (!active) return;
    const known = getCalendars();
    const ids = [...new Set([...known.keys(), ...active.calendar_ids])];
    if (!ids.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "カレンダーがありません。「カレンダー」で対象を選んでください。";
      choices.append(empty);
    }
    for (const id of ids) {
      const owner = Object.keys(SCHOOL_PERIOD_NAMES).find(key =>
        key !== picker.value && draft.schools[key].calendar_ids.includes(id));
      const label = document.createElement("label");
      label.className = "calendar-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = id;
      input.disabled = !!owner;
      input.checked = active.calendar_ids.includes(id);
      const name = document.createElement("span");
      const calendar = known.get(id);
      name.textContent = calendar || "現在表示対象にないカレンダー";
      if (owner) name.textContent += `（${SCHOOL_PERIOD_NAMES[owner]}に設定済み）`;
      if (!calendar) {
        const identifier = document.createElement("small");
        identifier.textContent = id;
        name.append(document.createElement("br"), identifier);
      }
      input.addEventListener("change", () => {
        active.calendar_ids = input.checked
          ? [...active.calendar_ids, id]
          : active.calendar_ids.filter(value => value !== id);
        updateCommands();
      });
      label.append(input, name);
      choices.append(label);
    }
  }

  function render() {
    const active = school();
    const legacyOption = mode.querySelector('option[value="legacy"]');
    legacyOption.hidden = !!active;
    legacyOption.disabled = !!active;
    mode.value = active?.mode ?? draft.common_mode;
    schoolFields.hidden = !active;
    commonFields.hidden = !!active;
    // Hidden required time fields must not interfere with saving another school.
    entries.replaceChildren();
    if (active) {
      renderCalendars();
      renderEntries();
    }
    updateCommands();
  }

  function receive(value) {
    saved = readPeriodProfiles(value);
    draft = structuredClone(saved);
    loaded = true;
    needsRefresh = false;
    loadLatest.hidden = true;
    render();
  }

  function preparePayload() {
    const result = structuredClone(draft);
    for (const [key, profile] of Object.entries(result.schools)) {
      if (!PERIOD_MODES.includes(profile.mode)) throw new Error("表示方法を選び直してください。");
      const starts = new Set();
      for (const entry of profile.periods) {
        entry.label = entry.label.trim();
        if (!entry.label || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start_time))
          throw new Error(`${SCHOOL_PERIOD_NAMES[key]}の時限名と開始時刻を入力してください。`);
        if (starts.has(entry.start_time))
          throw new Error(`${SCHOOL_PERIOD_NAMES[key]}で開始時刻 ${entry.start_time} が重複しています。`);
        starts.add(entry.start_time);
      }
      profile.periods.sort((a, b) => a.start_time.localeCompare(b.start_time));
    }
    return result;
  }

  picker.addEventListener("change", () => { notice(); render(); });
  mode.addEventListener("change", () => {
    if (school()) school().mode = mode.value;
    else draft.common_mode = mode.value;
    updateCommands();
  });
  add.addEventListener("click", () => {
    const active = school();
    if (!active || active.periods.length >= MAX_PERIODS) return;
    active.periods.push({ label: "", start_time: "" });
    renderEntries();
    updateCommands();
    entries.querySelector(".period-school-row:last-child [data-field=label]").focus();
  });
  reset.addEventListener("click", () => {
    draft = structuredClone(saved);
    notice("保存していない変更を取り消しました。");
    render();
    picker.focus();
  });
  editor.addEventListener("submit", async event => {
    event.preventDefault();
    if (!loaded || working || needsRefresh || !dirty()) return;
    let payload;
    try { payload = preparePayload(); }
    catch (failure) { notice(failure.message, true); return; }
    working = true;
    notice("保存しています…");
    updateCommands();
    try {
      const response = await request("/tutor-period-profiles", { method: "PUT", body: JSON.stringify(payload) });
      const result = readPeriodProfiles(response?.lesson_period_profiles);
      if (result.revision !== payload.revision + 1 ||
          JSON.stringify({ ...result, revision: payload.revision }) !== JSON.stringify(payload))
        throw Object.assign(new Error("保存結果を確認できませんでした。"), { unknown: true });
      receive(result);
      onSaved(result);
      notice("全デバイス共通の時限設定を保存しました。");
    } catch (failure) {
      if (failure.status === 409 || failure.unknown) {
        needsRefresh = true;
        loadLatest.hidden = false;
        notice(failure.status === 409
          ? "別の画面で設定が更新されました。入力は保持しています。最新の設定を読み直してください。"
          : "保存結果を確認できません。入力は保持しています。再送する前に最新の設定を読み直してください。", true);
      } else {
        notice("保存できませんでした。入力は保持しています。もう一度お試しください。", true);
      }
    } finally {
      working = false;
      updateCommands();
    }
  });
  loadLatest.addEventListener("click", async () => {
    if (working || (dirty() && !window.confirm("入力中の変更を取り消して、保存済みの設定を読み直しますか？"))) return;
    working = true;
    updateCommands();
    try {
      const response = await request("/settings");
      receive(response.lesson_period_profiles);
      onSaved(saved);
      notice("最新の時限設定を読み込みました。");
    } catch (failure) {
      notice(failure.message || "設定を取得できませんでした。", true);
    } finally { working = false; updateCommands(); }
  });
  render();
  return { receive, renderCalendars };
}
