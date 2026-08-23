import { getSessionToken, signIn, watchAuth } from "../shared/auth.js?v=11";

const VIEW_KEY = "works_admission_view";
const FILTER_KEY = "works_admission_filters";
const stageLabels = {
  primary: "一次試験",
  first_result: "一次発表",
  secondary: "二次試験",
  final_result: "合格発表",
};
const typeLabels = {
  general: "一般選抜",
  ct: "共通テスト利用",
  recommendation: "推薦",
  regional: "地域枠",
  comprehensive: "総合型選抜",
};

const els = {
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  signIn: document.querySelector("#sign-in"),
  authError: document.querySelector("#auth-error"),
  error: document.querySelector("#admission-error"),
  tabs: [...document.querySelectorAll("[data-admission-view-tab]")],
  views: [...document.querySelectorAll("[data-admission-view]")],
  list: document.querySelector("#admission-list"),
  table: document.querySelector("#admission-table-body"),
  calendarGrid: document.querySelector("#admission-calendar-grid"),
  calendarLabel: document.querySelector("#admission-calendar-label"),
  calendarPrev: document.querySelector("#admission-calendar-prev"),
  calendarNext: document.querySelector("#admission-calendar-next"),
  calendarEmpty: document.querySelector("#admission-calendar-empty"),
  gantt: document.querySelector("#admission-gantt"),
  ganttEmpty: document.querySelector("#admission-gantt-empty"),
  universityFilter: document.querySelector("#admission-university-filter"),
  typeFilter: document.querySelector("#admission-type-filter"),
  primaryMonthFilter: document.querySelector("#admission-primary-month-filter"),
  filterReset: document.querySelector("#admission-filter-reset"),
  add: document.querySelector("#admission-add"),
  editor: document.querySelector("#admission-editor"),
  editorClose: document.querySelector("#admission-editor-close"),
  form: document.querySelector("#admission-form"),
};

let events = [];
let calendarCursor = null;
let filters = loadFilters();

function loadFilters() {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_KEY) || "{}");
    return { university: String(stored.university || ""), type: String(stored.type || ""), primaryMonth: String(stored.primaryMonth || "") };
  } catch {
    return { university: "", type: "", primaryMonth: "" };
  }
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
}

function showError(error) {
  els.error.textContent = error instanceof Error ? error.message : String(error || "");
}

async function api(path, options = {}) {
  const token = getSessionToken();
  if (!token) throw new Error("ログイン情報が見つかりません");
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + token,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "入試日程の保存に失敗しました");
  return data;
}

function activateView(name) {
  const active = els.tabs.some((tab) => tab.dataset.admissionViewTab === name) ? name : "list";
  els.tabs.forEach((tab) => {
    const selected = tab.dataset.admissionViewTab === active;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  els.views.forEach((view) => { view.hidden = view.dataset.admissionView !== active; });
  localStorage.setItem(VIEW_KEY, active);
}

function syncFilterInputs() {
  els.universityFilter.value = filters.university;
  els.typeFilter.value = filters.type;
  els.primaryMonthFilter.value = filters.primaryMonth;
}

function primaryMonthByUniversity() {
  const map = new Map();
  events.filter((event) => event.stage === "primary").forEach((event) => {
    const date = eventDate(event);
    const current = map.get(event.university);
    if (!current || date < current) map.set(event.university, date);
  });
  events.forEach((event) => {
    if (map.has(event.university)) return;
    const date = eventDate(event);
    const current = map.get(event.university);
    if (!current || date < current) map.set(event.university, date);
  });
  return map;
}

function filteredEvents() {
  const query = filters.university.trim().toLocaleLowerCase("ja-JP");
  const primaryDates = primaryMonthByUniversity();
  return events.filter((event) => {
    if (query && !event.university.toLocaleLowerCase("ja-JP").includes(query)) return false;
    if (filters.type && event.selection_type !== filters.type) return false;
    if (filters.primaryMonth && String(primaryDates.get(event.university)?.getMonth() + 1) !== filters.primaryMonth) return false;
    return true;
  });
}

function renderList(viewEvents) {
  if (!viewEvents.length) {
    els.list.innerHTML = `<div class="admission-empty-state"><div><i class="bx bx-list-ul"></i><p>入試日程はまだ登録されていません</p><small>右上の「日程を追加」から、大学・方式・段階・日付を登録できます。</small></div></div>`;
    return;
  }
  els.list.innerHTML = viewEvents.map((event) => `
    <article class="admission-list-item admission-stage-${escapeHtml(event.stage)}">
      <time datetime="${escapeHtml(event.schedule_date)}">${escapeHtml(formatDate(event.schedule_date))}</time>
      <div class="admission-list-copy">
        <strong>${escapeHtml(event.university)}</strong>
        <span>${escapeHtml(typeLabels[event.selection_type] || event.selection_type)} ・ ${escapeHtml(stageLabels[event.stage] || event.stage)}</span>
        ${event.notes ? `<small>${escapeHtml(event.notes)}</small>` : ""}
      </div>
      <span class="admission-stage-badge">${escapeHtml(stageLabels[event.stage] || event.stage)}</span>
    </article>`).join("");
}

function renderTable(viewEvents) {
  if (!viewEvents.length) {
    els.table.innerHTML = `<tr class="admission-table-empty"><td colspan="5">入試日程はまだ登録されていません。</td></tr>`;
    return;
  }
  els.table.innerHTML = viewEvents.map((event) => `
    <tr>
      <td><strong>${escapeHtml(event.university)}</strong></td>
      <td>${escapeHtml(typeLabels[event.selection_type] || event.selection_type)}</td>
      <td>${escapeHtml(stageLabels[event.stage] || event.stage)}</td>
      <td>${escapeHtml(formatDate(event.schedule_date))}</td>
      <td>${escapeHtml(event.notes || "—")}</td>
    </tr>`).join("");
}

function calendarKey(date) {
  return date.getFullYear() + "-" + date.getMonth() + "-" + date.getDate();
}

function eventDate(event) {
  return new Date(event.schedule_date + "T00:00:00");
}

function stageClass(stage) {
  return "admission-stage-" + String(stage || "primary").replace(/[^a-z_]/g, "");
}

function renderCalendar(viewEvents) {
  if (!calendarCursor) return;
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  els.calendarLabel.textContent = year + "年" + (month + 1) + "月";

  const byDay = new Map();
  viewEvents.forEach((event) => {
    const date = eventDate(event);
    if (date.getFullYear() !== year || date.getMonth() !== month) return;
    const key = calendarKey(date);
    const items = byDay.get(key) || [];
    items.push(event);
    byDay.set(key, items);
  });

  const week = ["日", "月", "火", "水", "木", "金", "土"];
  const startOffset = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  let html = week.map((label) => `<div class="admission-calendar-weekday">${label}</div>`).join("");
  for (let i = 0; i < startOffset; i++) html += '<div class="admission-calendar-cell empty"></div>';
  for (let day = 1; day <= days; day++) {
    const date = new Date(year, month, day);
    const items = byDay.get(calendarKey(date)) || [];
    const cards = items.map((event) => `<span class="admission-calendar-event ${stageClass(event.stage)}" title="${escapeHtml(event.university)}｜${escapeHtml(stageLabels[event.stage] || event.stage)}"><b>${escapeHtml(event.university)}</b><small>${escapeHtml(stageLabels[event.stage] || event.stage)}</small></span>`).join("");
    html += `<div class="admission-calendar-cell"><time datetime="${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}">${day}</time>${cards}</div>`;
  }
  while ((startOffset + days) % 7) html += '<div class="admission-calendar-cell empty"></div>';
  els.calendarGrid.innerHTML = html;
  els.calendarEmpty.hidden = byDay.size > 0;
}

function addMonths(date, count) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function renderGantt(viewEvents) {
  if (!viewEvents.length) {
    els.gantt.innerHTML = "";
    els.ganttEmpty.hidden = false;
    return;
  }

  const dates = viewEvents.map(eventDate).sort((a, b) => a - b);
  const rangeStart = new Date(dates[0].getFullYear(), dates[0].getMonth(), dates[0].getDate());
  const rangeEnd = new Date(dates.at(-1).getFullYear(), dates.at(-1).getMonth(), dates.at(-1).getDate());
  const dayCount = Math.round((rangeEnd - rangeStart) / 86400000) + 1;
  const dayWidth = 38;
  const trackWidth = dayCount * dayWidth;
  const dayHeaders = Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(rangeStart);
    day.setDate(rangeStart.getDate() + index);
    const isMonthStart = day.getDate() === 1 || index === 0;
    return `<span class="${isMonthStart ? "is-month-start" : ""}" title="${formatDate(day.toISOString().slice(0, 10))}"><b>${day.getMonth() + 1}/${day.getDate()}</b><small>${["日", "月", "火", "水", "木", "金", "土"][day.getDay()]}</small></span>`;
  }).join("");

  const groups = [...new Set(viewEvents.map((event) => event.university))];
  const rows = groups.map((university) => {
    const rowEvents = viewEvents
      .filter((event) => event.university === university)
      .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
    const markers = rowEvents.map((event, index) => {
      const offsetDays = Math.round((eventDate(event) - rangeStart) / 86400000);
      const label = stageLabels[event.stage] || event.stage;
      const lane = index % 3;
      return `<span class="admission-gantt-marker ${stageClass(event.stage)}" style="left:${offsetDays * dayWidth + 2}px; top:${.3 + lane * 1.12}rem" title="${escapeHtml(formatDate(event.schedule_date))}｜${escapeHtml(university)}｜${escapeHtml(label)}">${escapeHtml(label.replace("試験", "").replace("発表", "発"))}</span>`;
    }).join("");
    return `<div class="admission-gantt-row"><strong title="${escapeHtml(university)}">${escapeHtml(university)}</strong><div class="admission-gantt-track" style="width:${trackWidth}px">${markers}</div></div>`;
  }).join("");

  els.gantt.innerHTML = `<div class="admission-gantt-axis"><span>大学・方式</span><div style="width:${trackWidth}px">${dayHeaders}</div></div><div class="admission-gantt-rows">${rows}</div>`;
  els.ganttEmpty.hidden = true;
}
function render() {
  const viewEvents = filteredEvents();
  syncFilterInputs();
  renderList(viewEvents);
  renderTable(viewEvents);
  if (!calendarCursor && viewEvents.length) {
    const first = eventDate(viewEvents[0]);
    calendarCursor = new Date(first.getFullYear(), first.getMonth(), 1);
  }
  renderCalendar(viewEvents);
  renderGantt(viewEvents);
}

async function loadEvents() {
  showError("");
  events = await api("/admissions");
  render();
}

function openEditor() {
  els.form.reset();
  els.form.schedule_date.value = new Date().toISOString().slice(0, 10);
  els.editor.showModal();
}

els.signIn.addEventListener("click", signIn);
els.add.addEventListener("click", openEditor);
els.editorClose.addEventListener("click", () => els.editor.close());
[els.universityFilter, els.typeFilter, els.primaryMonthFilter].forEach((input) => {
  input.addEventListener("input", () => {
    filters = { university: els.universityFilter.value, type: els.typeFilter.value, primaryMonth: els.primaryMonthFilter.value };
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    calendarCursor = null;
    render();
  });
  input.addEventListener("change", () => {
    filters = { university: els.universityFilter.value, type: els.typeFilter.value, primaryMonth: els.primaryMonthFilter.value };
    localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
    calendarCursor = null;
    render();
  });
});
els.filterReset.addEventListener("click", () => {
  filters = { university: "", type: "", primaryMonth: "" };
  localStorage.removeItem(FILTER_KEY);
  calendarCursor = null;
  render();
});
els.calendarPrev.addEventListener("click", () => {
  calendarCursor = addMonths(calendarCursor || new Date(), -1);
  renderCalendar();
});
els.calendarNext.addEventListener("click", () => {
  calendarCursor = addMonths(calendarCursor || new Date(), 1);
  renderCalendar();
});
els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => activateView(tab.dataset.admissionViewTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = els.tabs.indexOf(tab);
    const next = event.key === "ArrowRight"
      ? (index + 1) % els.tabs.length
      : (index - 1 + els.tabs.length) % els.tabs.length;
    els.tabs[next].focus();
    activateView(els.tabs[next].dataset.admissionViewTab);
  });
});
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.form);
  const body = Object.fromEntries(form.entries());
  try {
    await api("/admissions", { method: "POST", body: JSON.stringify(body) });
    els.editor.close();
    await loadEvents();
  } catch (error) {
    showError(error);
  }
});

activateView(localStorage.getItem(VIEW_KEY) || "list");
watchAuth({
  onSignedIn: async () => {
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;
    try {
      await loadEvents();
    } catch (error) {
      showError(error);
    }
  },
  onSignedOut: (message) => {
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    els.authError.textContent = message || "";
  },
});
