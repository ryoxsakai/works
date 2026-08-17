import {
  watchAuth,
  signIn,
  signOutUser,
  getGoogleAccessToken,
} from "../shared/auth.js?v=5";
import { getTheme, setTheme } from "../shared/theme.js?v=5";

const PASTEL_FALLBACK_COLORS = [
  "#c8e6c9",
  "#bbdefb",
  "#ffe0b2",
  "#f8bbd0",
  "#d1c4e9",
  "#b2ebf2",
  "#fff9c4",
];

const API_BASE = "/api";
const EVENT_VIEW_KEY = "works_event_view";
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const TOKEN_DELIMITER_RE = /([\s　()()【】\[\]・/,、:：\-])/;

const els = {
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  userEmail: document.querySelector("#user-email"),
  signInBtn: document.querySelector("#sign-in"),
  signOutBtn: document.querySelector("#sign-out"),
  actionError: document.querySelector("#action-error"),
  openSettingsBtn: document.querySelector("#open-settings"),
  settingsModal: document.querySelector("#settings-modal"),
  settingsCloseBtn: document.querySelector("#settings-close"),
  tabBtns: document.querySelectorAll(".tab-btn"),
  tabPanels: document.querySelectorAll(".modal-tab-panel"),
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  calendarChecklist: document.querySelector("#calendar-checklist"),
  termList: document.querySelector("#term-list"),
  addTermForm: document.querySelector("#add-term-form"),
  newTermLabel: document.querySelector("#new-term-label"),
  newTermStart: document.querySelector("#new-term-start"),
  newTermEnd: document.querySelector("#new-term-end"),
  studentSelect: document.querySelector("#student-select"),
  addStudentForm: document.querySelector("#add-student-form"),
  newStudentName: document.querySelector("#new-student-name"),
  newStudentTag: document.querySelector("#new-student-tag"),
  viewToggleBtns: document.querySelectorAll(".view-toggle-btn"),
  nameFilterBar: document.querySelector("#name-filter-bar"),
  nameFilterLabel: document.querySelector("#name-filter-label"),
  clearNameFilterBtn: document.querySelector("#clear-name-filter"),
  eventList: document.querySelector("#event-list"),
  calendarView: document.querySelector("#calendar-view"),
  calMonthLabel: document.querySelector("#cal-month-label"),
  calPrevBtn: document.querySelector("#cal-prev"),
  calNextBtn: document.querySelector("#cal-next"),
  calendarGrid: document.querySelector("#calendar-grid"),
  noteForm: document.querySelector("#note-form"),
  noteEventLabel: document.querySelector("#note-event-label"),
  noteText: document.querySelector("#note-text"),
  noteScore: document.querySelector("#note-score"),
  noteList: document.querySelector("#note-list"),
  authError: document.querySelector("#auth-error"),
};

let students = [];
let selectedStudent = null;
let selectedEvent = null;
let selectedCalendarIds = new Set();
let calendarColors = new Map(); // calendarId -> { bg, fg }
let terms = [];
let selectedTermIds = new Set();
let rawEvents = [];
let nameFilter = null;
let eventViewMode = localStorage.getItem(EVENT_VIEW_KEY) === "calendar" ? "calendar" : "list";
let calendarCursor = startOfMonth(new Date());

function showActionError(err) {
  els.actionError.textContent = err instanceof Error ? err.message : String(err);
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// --- 設定モーダル ---

els.openSettingsBtn.addEventListener("click", () => {
  const current = getTheme();
  els.themeRadios.forEach((r) => {
    r.checked = r.value === current;
  });
  els.settingsModal.showModal();
});

els.settingsCloseBtn.addEventListener("click", () => els.settingsModal.close());

els.tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.tabBtns.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    els.tabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.tabPanel !== btn.dataset.tab;
    });
  });
});

els.themeRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (radio.checked) setTheme(radio.value);
  });
});

// --- 授業予定の表示切り替え(リスト / カレンダー) ---

els.viewToggleBtns.forEach((btn) => {
  btn.setAttribute("aria-pressed", String(btn.dataset.view === eventViewMode));
  btn.addEventListener("click", () => {
    eventViewMode = btn.dataset.view;
    localStorage.setItem(EVENT_VIEW_KEY, eventViewMode);
    els.viewToggleBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    renderCurrentView();
  });
});

els.calPrevBtn.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  renderCurrentView();
});

els.calNextBtn.addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  renderCurrentView();
});

els.clearNameFilterBtn.addEventListener("click", () => {
  nameFilter = null;
  els.nameFilterBar.hidden = true;
  renderCurrentView();
});

// --- ログイン ---

els.signInBtn.addEventListener("click", () => {
  els.authError.textContent = "";
  signIn();
});

els.signOutBtn.addEventListener("click", () => signOutUser());

watchAuth({
  onSignedIn: async (user) => {
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;
    els.userEmail.textContent = user.email;
    els.actionError.textContent = "";
    try {
      await loadSettings();
      await loadCalendarList();
      await loadTerms();
      await loadStudents();
      await loadCalendarEvents();
    } catch (err) {
      showActionError(err);
    }
  },
  onSignedOut: (message) => {
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    els.authError.textContent = message || "";
  },
});

async function apiFetch(path, options = {}) {
  const token = getGoogleAccessToken();
  if (!token) throw new Error("not signed in");
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// --- サーバー側設定(対象カレンダー。デバイス間で共有) ---

async function loadSettings() {
  const settings = await apiFetch("/settings");
  selectedCalendarIds = new Set(settings.selected_calendars || []);
  selectedTermIds = new Set(settings.selected_term_ids || []);
}

async function saveSelectedCalendars() {
  await apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify({ selected_calendars: [...selectedCalendarIds] }),
  });
}

async function saveSelectedTerms() {
  await apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify({ selected_term_ids: [...selectedTermIds] }),
  });
}

async function loadCalendarList() {
  const token = getGoogleAccessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`カレンダー一覧の取得に失敗しました (${res.status})`);
  const data = await res.json();
  const calendars = data.items || [];
  calendarColors = new Map(
    calendars.map((c, i) => [
      c.id,
      {
        bg: c.backgroundColor || PASTEL_FALLBACK_COLORS[i % PASTEL_FALLBACK_COLORS.length],
        fg: c.foregroundColor || "#1a1a1a",
      },
    ])
  );
  renderCalendarChecklist(calendars);
}

function renderCalendarChecklist(calendars) {
  els.calendarChecklist.innerHTML = calendars
    .map((c) => {
      const checked = selectedCalendarIds.has(c.id) ? "checked" : "";
      const color = calendarColors.get(c.id);
      const dot = color
        ? `<span class="calendar-color-dot" style="background-color:${escapeHtml(color.bg)}"></span>`
        : "";
      return `<label class="calendar-item">
        <input type="checkbox" value="${escapeHtml(c.id)}" ${checked} />
        ${dot}${escapeHtml(c.summary || c.id)}
      </label>`;
    })
    .join("");
}

// --- 学期(期間)設定。デバイス間で共有し、複数選択で予定を絞り込む ---

async function loadTerms() {
  terms = await apiFetch("/terms");
  renderTermsList();
}

function renderTermsList() {
  if (terms.length === 0) {
    els.termList.innerHTML = `<p class="hint">まだ期間が登録されていません。</p>`;
    return;
  }
  els.termList.innerHTML = terms
    .map((t) => {
      const checked = selectedTermIds.has(t.id) ? "checked" : "";
      return `<div class="term-item">
        <input type="checkbox" class="term-checkbox" value="${t.id}" ${checked} />
        <span class="term-item-label">${escapeHtml(t.label)}</span>
        <span class="term-item-dates">${t.start_date} 〜 ${t.end_date}</span>
        <button type="button" class="term-delete" data-id="${t.id}">削除</button>
      </div>`;
    })
    .join("");
}

els.termList.addEventListener("change", async (e) => {
  const checkbox = e.target.closest(".term-checkbox");
  if (!checkbox) return;
  const id = Number(checkbox.value);
  if (checkbox.checked) {
    selectedTermIds.add(id);
  } else {
    selectedTermIds.delete(id);
  }
  try {
    await saveSelectedTerms();
    await loadCalendarEvents();
  } catch (err) {
    showActionError(err);
  }
});

els.termList.addEventListener("click", async (e) => {
  const btn = e.target.closest(".term-delete");
  if (!btn) return;
  if (!confirm("この期間設定を削除しますか?")) return;
  try {
    await apiFetch(`/terms/${btn.dataset.id}`, { method: "DELETE" });
    selectedTermIds.delete(Number(btn.dataset.id));
    await loadTerms();
    await saveSelectedTerms();
    await loadCalendarEvents();
  } catch (err) {
    showActionError(err);
  }
});

els.addTermForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const label = els.newTermLabel.value.trim();
  const startDate = els.newTermStart.value;
  const endDate = els.newTermEnd.value;
  if (!label || !startDate || !endDate) return;
  try {
    await apiFetch("/terms", {
      method: "POST",
      body: JSON.stringify({ label, start_date: startDate, end_date: endDate }),
    });
    els.newTermLabel.value = "";
    els.newTermStart.value = "";
    els.newTermEnd.value = "";
    await loadTerms();
  } catch (err) {
    showActionError(err);
  }
});

els.calendarChecklist.addEventListener("change", async (e) => {
  const checkbox = e.target.closest("input[type=checkbox]");
  if (!checkbox) return;
  if (checkbox.checked) {
    selectedCalendarIds.add(checkbox.value);
  } else {
    selectedCalendarIds.delete(checkbox.value);
  }
  try {
    await saveSelectedCalendars();
    await loadCalendarEvents();
  } catch (err) {
    showActionError(err);
  }
});

async function loadStudents() {
  students = await apiFetch("/students");
  els.studentSelect.innerHTML =
    `<option value="">生徒を選択</option>` +
    students.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
}

els.studentSelect.addEventListener("change", async () => {
  const id = els.studentSelect.value;
  selectedStudent = students.find((s) => String(s.id) === id) || null;
  els.noteForm.hidden = true;
  try {
    await loadCalendarEvents();
    await loadNotes();
  } catch (err) {
    showActionError(err);
  }
});

els.addStudentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const name = els.newStudentName.value.trim();
  const tag = els.newStudentTag.value.trim();
  if (!name) return;
  try {
    await apiFetch("/students", {
      method: "POST",
      body: JSON.stringify({ name, calendar_tag: tag }),
    });
    els.newStudentName.value = "";
    els.newStudentTag.value = "";
    await loadStudents();
  } catch (err) {
    showActionError(err);
  }
});

// --- 授業予定の取得・絞り込み・表示 ---

async function loadCalendarEvents() {
  const token = getGoogleAccessToken();
  if (!token) {
    showEventPlaceholder("カレンダーへのアクセス許可を確認しています…");
    return;
  }
  if (selectedCalendarIds.size === 0) {
    showEventPlaceholder("設定からカレンダーを選択してください");
    return;
  }

  const activeTerms = terms.filter((t) => selectedTermIds.has(t.id));
  let timeMin, timeMax;
  if (activeTerms.length > 0) {
    timeMin = new Date(
      Math.min(...activeTerms.map((t) => new Date(`${t.start_date}T00:00:00`).getTime()))
    ).toISOString();
    timeMax = new Date(
      Math.max(...activeTerms.map((t) => new Date(`${t.end_date}T23:59:59`).getTime()))
    ).toISOString();
  } else {
    timeMin = new Date(Date.now() - 90 * 86400000).toISOString();
    timeMax = new Date(Date.now() + 90 * 86400000).toISOString();
  }
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const results = await Promise.all(
    [...selectedCalendarIds].map(async (calendarId) => {
      const res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (data.items || []).map((ev) => ({ ...ev, _calendarId: calendarId }));
    })
  );

  rawEvents = results.flat().sort((a, b) => {
    const aStart = a.start?.dateTime || a.start?.date || "";
    const bStart = b.start?.dateTime || b.start?.date || "";
    return aStart.localeCompare(bStart);
  });

  renderCurrentView();
}

function showEventPlaceholder(message) {
  els.calendarView.hidden = true;
  els.eventList.hidden = false;
  els.eventList.innerHTML = `<li>${escapeHtml(message)}</li>`;
}

function isWithinSelectedTerms(ev) {
  if (selectedTermIds.size === 0) return true;
  const startStr = ev.start?.dateTime || ev.start?.date;
  if (!startStr) return false;
  const d = startStr.slice(0, 10);
  return terms.some(
    (t) => selectedTermIds.has(t.id) && d >= t.start_date && d <= t.end_date
  );
}

function getFilteredEvents() {
  let events = rawEvents.filter(isWithinSelectedTerms);
  if (selectedStudent?.calendar_tag) {
    const tag = selectedStudent.calendar_tag.toLowerCase();
    events = events.filter((ev) =>
      `${ev.summary || ""} ${ev.description || ""}`.toLowerCase().includes(tag)
    );
  }
  if (nameFilter) {
    const needle = nameFilter.toLowerCase();
    events = events.filter((ev) =>
      `${ev.summary || ""} ${ev.description || ""}`.toLowerCase().includes(needle)
    );
  }
  return events;
}

function renderCurrentView() {
  const events = getFilteredEvents();
  if (eventViewMode === "calendar") {
    renderCalendarView(events);
  } else {
    renderListView(events);
  }
}

function eventColorStyle(ev) {
  const color = calendarColors.get(ev._calendarId);
  if (!color) return "";
  return ` style="background-color:${escapeHtml(color.bg)};color:${escapeHtml(color.fg)};border-color:${escapeHtml(color.bg)}"`;
}

function renderTokenizedSummary(summary) {
  return summary
    .split(TOKEN_DELIMITER_RE)
    .filter((part) => part !== "")
    .map((part) => {
      if (TOKEN_DELIMITER_RE.test(part) && part.length === 1) return escapeHtml(part);
      return `<span class="name-token" data-token="${escapeHtml(part)}">${escapeHtml(part)}</span>`;
    })
    .join("");
}

function renderListView(events) {
  els.calendarView.hidden = true;
  els.eventList.hidden = false;

  if (events.length === 0) {
    els.eventList.innerHTML = "<li>該当する授業予定がありません</li>";
    return;
  }
  els.eventList.innerHTML = events
    .map((ev) => {
      const start = ev.start?.dateTime || ev.start?.date || "";
      const summaryRaw = ev.summary || "(無題)";
      return `<li class="event-item" data-id="${ev.id}" data-summary="${escapeHtml(summaryRaw)}" data-start="${start}"${eventColorStyle(ev)}>
        <span class="event-date">${formatDate(start)}</span>
        <span class="event-summary">${renderTokenizedSummary(summaryRaw)}</span>
      </li>`;
    })
    .join("");
}

function renderCalendarView(events) {
  els.eventList.hidden = true;
  els.calendarView.hidden = false;

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  els.calMonthLabel.textContent = `${year}年${month + 1}月`;

  const eventsByDay = {};
  events.forEach((ev) => {
    const startStr = ev.start?.dateTime || ev.start?.date;
    if (!startStr) return;
    const d = new Date(startStr);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    (eventsByDay[key] ||= []).push(ev);
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = new Date(year, month, 1).getDay();
  const today = new Date();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);

  let html = WEEKDAY_LABELS.map((w) => `<div class="cal-weekday">${w}</div>`).join("");

  html += cells
    .map((day) => {
      if (!day) return `<div class="cal-cell cal-cell-empty"></div>`;
      const isToday =
        year === today.getFullYear() && month === today.getMonth() && day === today.getDate();
      const dayEvents = eventsByDay[`${year}-${month}-${day}`] || [];
      const visible = dayEvents.slice(0, 3);
      const overflow = dayEvents.length - visible.length;
      const eventsHtml = visible
        .map((ev) => {
          const summaryRaw = ev.summary || "(無題)";
          return `<button type="button" class="cal-event" data-id="${ev.id}" data-summary="${escapeHtml(summaryRaw)}" data-start="${ev.start?.dateTime || ev.start?.date || ""}"${eventColorStyle(ev)}>${escapeHtml(summaryRaw)}</button>`;
        })
        .join("");
      const overflowHtml = overflow > 0 ? `<div class="cal-more">+${overflow}件</div>` : "";
      return `<div class="cal-cell${isToday ? " cal-cell-today" : ""}">
        <div class="cal-day-num">${day}</div>
        ${eventsHtml}
        ${overflowHtml}
      </div>`;
    })
    .join("");

  els.calendarGrid.innerHTML = html;
}

function selectEventForNote(id, summary, start) {
  if (!selectedStudent) return;
  selectedEvent = { id, summary, start };
  els.noteEventLabel.textContent = `${formatDate(start)} — ${summary}`;
  els.noteForm.hidden = false;
}

function applyNameFilter(token) {
  nameFilter = token;
  els.nameFilterLabel.textContent = token;
  els.nameFilterBar.hidden = false;
  renderCurrentView();
}

els.eventList.addEventListener("click", (e) => {
  const tokenEl = e.target.closest(".name-token");
  if (tokenEl) {
    applyNameFilter(tokenEl.dataset.token);
    return;
  }
  const item = e.target.closest(".event-item");
  if (!item) return;
  selectEventForNote(item.dataset.id, item.dataset.summary, item.dataset.start);
});

els.calendarGrid.addEventListener("click", (e) => {
  const btn = e.target.closest(".cal-event");
  if (!btn) return;
  selectEventForNote(btn.dataset.id, btn.dataset.summary, btn.dataset.start);
});

els.noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  if (!selectedStudent || !selectedEvent) return;
  try {
    await apiFetch("/lessons", {
      method: "POST",
      body: JSON.stringify({
        student_id: selectedStudent.id,
        calendar_event_id: selectedEvent.id,
        lesson_date: selectedEvent.start,
        note: els.noteText.value,
        score: els.noteScore.value,
      }),
    });
    els.noteText.value = "";
    els.noteScore.value = "";
    await loadNotes();
  } catch (err) {
    showActionError(err);
  }
});

async function loadNotes() {
  if (!selectedStudent) {
    els.noteList.innerHTML = "";
    return;
  }
  const notes = await apiFetch(`/lessons?student_id=${selectedStudent.id}`);
  els.noteList.innerHTML = notes
    .map((n) => {
      const note = escapeHtml(n.note || "");
      const score = n.score ? ` (評価: ${escapeHtml(n.score)})` : "";
      return `<li>${formatDate(n.lesson_date)} — ${note}${score}</li>`;
    })
    .join("");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function escapeHtml(str) {
  return str.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
