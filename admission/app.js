import { getSessionToken, signIn, watchAuth } from "../shared/auth.js?v=11";

const VIEW_KEY = "works_admission_view";
const FILTER_KEY = "works_admission_filters";
const CALENDAR_MODE_KEY = "works_admission_calendar_mode";
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

const calendarTypeLabels = {
  general: "一般",
  ct: "共テ",
  recommendation: "推薦",
  regional: "地域枠",
  comprehensive: "総合型",
};

const printTypeLabels = {
  general: "一般",
  ct: "共テ",
  recommendation: "推薦",
  regional: "地域",
  comprehensive: "総合",
};
const printStageLabels = {
  primary: "一次",
  first_result: "一次発",
  secondary: "二次",
  final_result: "合格",
};

const universityReadings = {
  "愛知医科": "あいちいか",
  "岩手医科": "いわていか",
  "大阪医科薬科": "おおさかいかやっか",
  "川崎医科": "かわさきいか",
  "金沢医科": "かなざわいか",
  "北里": "きたさと",
  "慶應義塾": "けいおうぎじゅく",
  "近畿": "きんき",
  "杏林": "きょうりん",
  "国際医療福祉": "こくさいいりょうふくし",
  "産業医科": "さんぎょういか",
  "自治医科": "じちいか",
  "順天堂": "じゅんてんどう",
  "聖マリアンナ医科": "せいまりあんないか",
  "帝京": "ていきょう",
  "東京医科": "とうきょういか",
  "東京慈恵会医科": "とうきょうじけいかいいか",
  "東京女子医科": "とうきょうじょしいか",
  "東北医科薬科": "とうほくいかやっか",
  "獨協医科": "どっきょういか",
  "日本医科": "にほんいか",
  "兵庫医科": "ひょうごいか",
  "藤田医科": "ふじたいか",
};
const universityCollator = new Intl.Collator("ja-JP", { sensitivity: "base", numeric: true });

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
  calendarContinuous: document.querySelector("#admission-calendar-continuous"),
  calendarModeButtons: [...document.querySelectorAll("[data-admission-calendar-mode]")],
  calendarNav: document.querySelector("#admission-calendar-nav"),
  calendarLabel: document.querySelector("#admission-calendar-label"),
  calendarPrev: document.querySelector("#admission-calendar-prev"),
  calendarNext: document.querySelector("#admission-calendar-next"),
  calendarEmpty: document.querySelector("#admission-calendar-empty"),
  gantt: document.querySelector("#admission-gantt"),
  ganttEmpty: document.querySelector("#admission-gantt-empty"),
  filterOpen: document.querySelector("#admission-filter-open"),
  filterCount: document.querySelector("#admission-filter-count"),
  filterSummary: document.querySelector("#admission-filter-summary"),
  filterReset: document.querySelector("#admission-filter-reset"),
  filterModal: document.querySelector("#admission-filter-modal"),
  filterClose: document.querySelector("#admission-filter-close"),
  filterForm: document.querySelector("#admission-filter-form"),
  filterTabs: [...document.querySelectorAll("[data-admission-filter-tab]")],
  filterPanels: [...document.querySelectorAll("[data-admission-filter-panel]")],
  filterUniversitySearch: document.querySelector("#admission-filter-university-search"),
  filterUniversityList: document.querySelector("#admission-filter-university-list"),
  filterSelectAll: [...document.querySelectorAll("[data-admission-filter-select-all]")],
  filterClearGroups: [...document.querySelectorAll("[data-admission-filter-clear-group]")],
  filterClear: document.querySelector("#admission-filter-clear"),
  print: document.querySelector("#admission-print"),
  ganttPrint: document.querySelector("#admission-gantt-print"),
};

let events = [];
let calendarCursor = null;
let calendarMode = loadCalendarMode();
let filters = loadFilters();
let activeView = "list";
let eventsLoaded = false;

function asStringList(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : [];
}

function loadCalendarMode() {
  return localStorage.getItem(CALENDAR_MODE_KEY) === "continuous" ? "continuous" : "month";
}

function emptyFilters() {
  return { universities: [], types: [], primaryMonths: [] };
}

function loadFilters() {
  try {
    const stored = JSON.parse(localStorage.getItem(FILTER_KEY) || "{}");
    return {
      universities: asStringList(stored.universities).length
        ? asStringList(stored.universities)
        : (stored.university ? [String(stored.university)] : []),
      types: asStringList(stored.types).length
        ? asStringList(stored.types)
        : (stored.type ? [String(stored.type)] : []),
      primaryMonths: asStringList(stored.primaryMonths).length
        ? asStringList(stored.primaryMonths)
        : (stored.primaryMonth ? [String(stored.primaryMonth)] : []),
    };
  } catch {
    return emptyFilters();
  }
}

function saveFilters() {
  const count = filters.universities.length + filters.types.length + filters.primaryMonths.length;
  if (count) localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
  else localStorage.removeItem(FILTER_KEY);
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

function canonicalUniversityName(value) {
  return String(value || "")
    .replace(/（[^）]*）/g, "")
    .trim()
    .replace(/大学医学部$/, "")
    .replace(/医学部$/, "")
    .replace(/大学$/, "")
    .trim();
}

function sortUniversities(a, b) {
  const readingA = universityReadings[a] || a;
  const readingB = universityReadings[b] || b;
  return universityCollator.compare(readingA, readingB) || universityCollator.compare(a, b);
}

function uniqueParts(parts) {
  return [...new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))];
}

function tableUniversityDetails(event) {
  const raw = String(event.university || "");
  const qualifiers = [...raw.matchAll(/（([^）]+)）/g)]
    .flatMap((match) => match[1].split(/[・／/]/))
    .map((part) => part.trim())
    .filter(Boolean);
  const redundant = {
    general: ["一般", "一般選抜"],
    ct: ["共テ", "共テ利用", "共通テスト", "共通テスト利用"],
    recommendation: ["推薦", "学校推薦"],
    regional: ["地域枠"],
    comprehensive: ["総合型", "総合型選抜"],
  }[event.selection_type] || [];

  const methodParts = [];
  const noteParts = [];
  qualifiers.forEach((part) => {
    if (redundant.includes(part)) return;
    if (/枠|地域|定着|特別|指定/.test(part)) {
      noteParts.push(part);
    } else if (/方式|前期|後期|推薦|総合型|共通テスト|共テ|一般|入試|選抜/.test(part)) {
      methodParts.push(part);
    } else {
      noteParts.push(part);
    }
  });

  const type = typeLabels[event.selection_type] || event.selection_type;
  const normalizedMethods = uniqueParts(methodParts).map((part) => ({
    "一般": "一般選抜",
    "共テ": "共通テスト利用",
    "共テ利用": "共通テスト利用",
    "共通テスト": "共通テスト利用",
    "推薦": "推薦",
    "総合型": "総合型選抜",
  }[part] || part));
  const qualifierDefinesMethod = event.selection_type === "regional" &&
    normalizedMethods.some((part) => /一般|共通テスト|推薦|総合型/.test(part));
  const method = qualifierDefinesMethod
    ? normalizedMethods.join("・")
    : (normalizedMethods.length ? `${type}（${normalizedMethods.join("・")}）` : type);
  const notes = uniqueParts([...noteParts, event.notes]).join("／");
  return { university: canonicalUniversityName(raw), method, notes };
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
  activeView = active;
  els.tabs.forEach((tab) => {
    const selected = tab.dataset.admissionViewTab === active;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  els.views.forEach((view) => { view.hidden = view.dataset.admissionView !== active; });
  localStorage.setItem(VIEW_KEY, active);
  if (eventsLoaded) render();
}

function activateCalendarMode(mode) {
  calendarMode = mode === "continuous" ? "continuous" : "month";
  localStorage.setItem(CALENDAR_MODE_KEY, calendarMode);
  els.calendarModeButtons.forEach((button) => {
    const selected = button.dataset.admissionCalendarMode === calendarMode;
    button.setAttribute("aria-pressed", String(selected));
  });
  els.calendarNav.hidden = calendarMode === "continuous";
  els.calendarGrid.hidden = calendarMode === "continuous";
  els.calendarContinuous.hidden = calendarMode !== "continuous";
  if (eventsLoaded && activeView === "calendar") render();
}

function activateFilterTab(name) {
  const active = els.filterTabs.some((tab) => tab.dataset.admissionFilterTab === name) ? name : "universities";
  els.filterTabs.forEach((tab) => {
    const selected = tab.dataset.admissionFilterTab === active;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  els.filterPanels.forEach((panel) => {
    panel.hidden = panel.dataset.admissionFilterPanel !== active;
  });
}

function renderUniversityChoices() {
  const universities = [...new Set(events.map((event) => canonicalUniversityName(event.university)).filter(Boolean))]
    .sort(sortUniversities);
  els.filterUniversityList.innerHTML = universities.map((university) => `
    <label class="admission-filter-option">
      <input type="checkbox" name="filter_university" value="${escapeHtml(university)}" />
      <span>${escapeHtml(university)}</span>
    </label>`).join("");
}

function syncFilterModal() {
  const groups = [
    ["filter_university", filters.universities],
    ["filter_type", filters.types],
    ["filter_month", filters.primaryMonths],
  ];
  groups.forEach(([name, selected]) => {
    els.filterForm.querySelectorAll(`input[name="${name}"]`).forEach((input) => {
      input.checked = selected.includes(input.value);
    });
  });
}

function filterUniversityOptions() {
  const query = els.filterUniversitySearch.value.trim().toLocaleLowerCase("ja-JP");
  els.filterUniversityList.querySelectorAll(".admission-filter-option").forEach((option) => {
    option.hidden = Boolean(query) && !option.textContent.toLocaleLowerCase("ja-JP").includes(query);
  });
}

function normalizeLegacyUniversityFilters() {
  const rawNames = [...new Set(events.map((event) => event.university).filter(Boolean))];
  const known = [...new Set(rawNames.map(canonicalUniversityName).filter(Boolean))];
  const normalized = [...new Set(filters.universities.flatMap((selected) => {
    const direct = canonicalUniversityName(selected);
    if (known.includes(direct)) return [direct];
    const query = selected.toLocaleLowerCase("ja-JP");
    return known.filter((university) => {
      if (university.toLocaleLowerCase("ja-JP").includes(query)) return true;
      return rawNames.some((raw) =>
        canonicalUniversityName(raw) === university &&
        raw.toLocaleLowerCase("ja-JP").includes(query)
      );
    });
  }))];
  if (JSON.stringify(normalized) !== JSON.stringify(filters.universities)) {
    filters.universities = normalized;
    saveFilters();
  }
}

function renderFilterSummary() {
  const count = filters.universities.length + filters.types.length + filters.primaryMonths.length;
  els.filterCount.hidden = count === 0;
  els.filterCount.textContent = String(count);
  els.filterReset.hidden = count === 0;
  if (!count) {
    els.filterSummary.textContent = "すべての入試日程";
    return;
  }
  const parts = [];
  if (filters.universities.length) parts.push(`大学 ${filters.universities.length}件`);
  if (filters.types.length) {
    const labels = filters.types.map((value) => typeLabels[value] || value);
    parts.push(`方式 ${labels.length <= 2 ? labels.join("・") : labels.length + "件"}`);
  }
  if (filters.primaryMonths.length) {
    parts.push(`一次月 ${filters.primaryMonths.map((month) => month + "月").join("・")}`);
  }
  els.filterSummary.textContent = parts.join(" / ");
}

function openFilterModal() {
  renderUniversityChoices();
  syncFilterModal();
  els.filterUniversitySearch.value = "";
  filterUniversityOptions();
  activateFilterTab("universities");
  els.filterModal.showModal();
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
  const primaryDates = primaryMonthByUniversity();
  return events.filter((event) => {
    if (filters.universities.length && !filters.universities.includes(canonicalUniversityName(event.university))) return false;
    if (filters.types.length && !filters.types.includes(event.selection_type)) return false;
    if (filters.primaryMonths.length && !filters.primaryMonths.includes(String(primaryDates.get(event.university)?.getMonth() + 1))) return false;
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
  els.table.innerHTML = viewEvents.map((event) => {
    const details = tableUniversityDetails(event);
    const rowTypeClass = "admission-type-" + String(event.selection_type || "general").replace(/[^a-z_]/g, "");
    return `
      <tr class="${rowTypeClass}">
        <td><strong>${escapeHtml(details.university)}</strong></td>
        <td>${escapeHtml(details.method)}</td>
        <td>${escapeHtml(stageLabels[event.stage] || event.stage)}</td>
        <td>${escapeHtml(formatDate(event.schedule_date))}</td>
        <td>${escapeHtml(details.notes || "—")}</td>
      </tr>`;
  }).join("");
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

function calendarMonthMarkup(year, month, viewEvents) {
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
    const cards = items.map((event) => {
      const university = canonicalUniversityName(event.university);
      const type = calendarTypeLabels[event.selection_type] || event.selection_type;
      const shortLabel = university + "・" + type;
      const fullTitle = [
        event.university,
        typeLabels[event.selection_type] || event.selection_type,
        stageLabels[event.stage] || event.stage,
      ].join("｜");
      return `<span class="admission-calendar-event ${stageClass(event.stage)}" title="${escapeHtml(fullTitle)}"><b>${escapeHtml(shortLabel)}</b><small>${escapeHtml(stageLabels[event.stage] || event.stage)}</small></span>`;
    }).join("");
    html += `<div class="admission-calendar-cell"><time datetime="${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}">${day}</time>${cards}</div>`;
  }
  const trailingCells = (7 - ((startOffset + days) % 7)) % 7;
  for (let i = 0; i < trailingCells; i++) html += '<div class="admission-calendar-cell empty"></div>';
  return { html, hasEvents: byDay.size > 0 };
}

function renderCalendar(viewEvents) {
  if (!calendarCursor) {
    els.calendarLabel.textContent = "";
    els.calendarGrid.replaceChildren();
    els.calendarEmpty.hidden = false;
    return;
  }
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const calendar = calendarMonthMarkup(year, month, viewEvents);
  els.calendarLabel.textContent = year + "年" + (month + 1) + "月";
  els.calendarGrid.innerHTML = calendar.html;
  els.calendarEmpty.hidden = calendar.hasEvents;
}

function renderContinuousCalendar(viewEvents) {
  els.calendarContinuous.replaceChildren();
  if (!viewEvents.length) {
    els.calendarEmpty.hidden = false;
    return;
  }

  const dates = viewEvents.map(eventDate).sort((a, b) => a - b);
  const first = dates[0];
  const last = dates.at(-1);
  const months = [];
  for (
    let cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    cursor <= new Date(last.getFullYear(), last.getMonth(), 1);
    cursor = addMonths(cursor, 1)
  ) {
    months.push(new Date(cursor));
  }

  els.calendarContinuous.innerHTML = months.map((monthDate) => {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const calendar = calendarMonthMarkup(year, month, viewEvents);
    return `<section class="admission-calendar-month" aria-label="${year}年${month + 1}月">
      <h3>${year}年${month + 1}月</h3>
      <div class="admission-calendar-grid">${calendar.html}</div>
    </section>`;
  }).join("");
  els.calendarEmpty.hidden = true;
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

function renderPrintableGantt(viewEvents) {
  if (!viewEvents.length) {
    els.ganttPrint.innerHTML = '<p class="admission-view-note">表示できる入試日程はありません。</p>';
    return;
  }

  const universities = [...new Set(viewEvents.map((event) => canonicalUniversityName(event.university)))]
    .sort(sortUniversities);
  els.ganttPrint.innerHTML = universities.map((university) => {
    const universityEvents = viewEvents
      .filter((event) => canonicalUniversityName(event.university) === university)
      .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date));
    const dates = universityEvents.map(eventDate);
    const start = new Date(dates[0].getFullYear(), dates[0].getMonth(), 1);
    const lastDate = dates.at(-1);
    const end = new Date(lastDate.getFullYear(), lastDate.getMonth(), 1);
    const months = [];
    for (let cursor = new Date(start); cursor <= end; cursor = addMonths(cursor, 1)) {
      months.push(new Date(cursor));
    }

    const monthRows = months.map((monthDate) => {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const dayCount = new Date(year, month + 1, 0).getDate();
      const monthEvents = universityEvents.filter((event) => {
        const date = eventDate(event);
        return date.getFullYear() === year && date.getMonth() === month;
      });
      const byDay = new Map();
      monthEvents.forEach((event) => {
        const day = eventDate(event).getDate();
        const entries = byDay.get(day) || [];
        entries.push(event);
        byDay.set(day, entries);
      });
      const days = Array.from({ length: dayCount }, (_, index) => {
        const day = index + 1;
        const date = new Date(year, month, day);
        const entries = (byDay.get(day) || []).map((event) => `
          <span class="admission-gantt-print-event ${stageClass(event.stage)}">
            <b>${escapeHtml(printTypeLabels[event.selection_type] || event.selection_type)}</b>
            <small>${escapeHtml(printStageLabels[event.stage] || event.stage)}</small>
          </span>`).join("");
        const weekendClass = date.getDay() === 0 ? " is-sunday" : (date.getDay() === 6 ? " is-saturday" : "");
        return `<div class="admission-gantt-print-day${weekendClass}"><time>${day}</time>${entries}</div>`;
      }).join("");
      return `
        <div class="admission-gantt-print-month">
          <strong>${year}年${month + 1}月</strong>
          <div class="admission-gantt-print-days" style="--admission-print-days:${dayCount}">${days}</div>
        </div>`;
    }).join("");

    return `
      <section class="admission-gantt-print-university">
        <h3>${escapeHtml(university)}</h3>
        ${monthRows}
      </section>`;
  }).join("");
}

function cleanupPrintView() {
  delete document.body.dataset.admissionPrintView;
  els.ganttPrint.replaceChildren();
}

function printActiveView() {
  document.body.dataset.admissionPrintView = activeView;
  if (activeView === "gantt") renderPrintableGantt(filteredEvents());
  window.print();
}

function clearInactiveViews() {
  if (activeView !== "list") els.list.replaceChildren();
  if (activeView !== "table") els.table.replaceChildren();
  if (activeView !== "calendar") {
    els.calendarGrid.replaceChildren();
    els.calendarContinuous.replaceChildren();
    els.calendarEmpty.hidden = true;
  }
  if (activeView !== "gantt") {
    els.gantt.replaceChildren();
    els.ganttEmpty.hidden = true;
  }
}

function render() {
  const viewEvents = filteredEvents();
  renderFilterSummary();
  clearInactiveViews();

  if (activeView === "list") {
    renderList(viewEvents);
    return;
  }
  if (activeView === "table") {
    renderTable(viewEvents);
    return;
  }
  if (activeView === "calendar") {
    if (!calendarCursor && viewEvents.length) {
      const first = eventDate(viewEvents[0]);
      calendarCursor = new Date(first.getFullYear(), first.getMonth(), 1);
    }
    if (calendarMode === "continuous") renderContinuousCalendar(viewEvents);
    else renderCalendar(viewEvents);
    return;
  }
  renderGantt(viewEvents);
}

async function loadEvents() {
  showError("");
  events = await api("/admissions");
  eventsLoaded = true;
  normalizeLegacyUniversityFilters();
  renderUniversityChoices();
  render();
}

els.signIn.addEventListener("click", signIn);
els.print.addEventListener("click", printActiveView);
window.addEventListener("afterprint", cleanupPrintView);
els.filterOpen.addEventListener("click", openFilterModal);
els.filterClose.addEventListener("click", () => els.filterModal.close());
els.filterUniversitySearch.addEventListener("input", filterUniversityOptions);
els.filterTabs.forEach((tab) => {
  tab.addEventListener("click", () => activateFilterTab(tab.dataset.admissionFilterTab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const index = els.filterTabs.indexOf(tab);
    const next = event.key === "ArrowRight"
      ? (index + 1) % els.filterTabs.length
      : (index - 1 + els.filterTabs.length) % els.filterTabs.length;
    els.filterTabs[next].focus();
    activateFilterTab(els.filterTabs[next].dataset.admissionFilterTab);
  });
});
els.filterSelectAll.forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.dataset.admissionFilterSelectAll;
    els.filterForm.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = true; });
  });
});
els.filterClearGroups.forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.dataset.admissionFilterClearGroup;
    els.filterForm.querySelectorAll(`input[name="${name}"]`).forEach((input) => { input.checked = false; });
  });
});
els.filterClear.addEventListener("click", () => {
  els.filterForm.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
});
els.filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(els.filterForm);
  filters = {
    universities: form.getAll("filter_university").map(String),
    types: form.getAll("filter_type").map(String),
    primaryMonths: form.getAll("filter_month").map(String),
  };
  saveFilters();
  calendarCursor = null;
  render();
  els.filterModal.close();
});
els.filterReset.addEventListener("click", () => {
  filters = emptyFilters();
  saveFilters();
  calendarCursor = null;
  render();
});
els.calendarModeButtons.forEach((button) => {
  button.addEventListener("click", () => activateCalendarMode(button.dataset.admissionCalendarMode));
});
els.calendarPrev.addEventListener("click", () => {
  calendarCursor = addMonths(calendarCursor || new Date(), -1);
  renderCalendar(filteredEvents());
});
els.calendarNext.addEventListener("click", () => {
  calendarCursor = addMonths(calendarCursor || new Date(), 1);
  renderCalendar(filteredEvents());
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
activateFilterTab("universities");
activateCalendarMode(calendarMode);
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
