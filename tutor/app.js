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
const CURRICULUM_STATE_KEY = "works_curriculum_state";
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const TOKEN_DELIMITER_RE = /([\s　()()【】\[\]・/,、:：\-])/;

// あいうえお順(私立医学部31校)。分類に迷う大学(自治医科大学・産業医科大学など)も含めているため、
// 必要に応じて調整してください。
const PRIVATE_MED_SCHOOLS = [
  "愛知医科大学",
  "岩手医科大学",
  "大阪医科薬科大学",
  "金沢医科大学",
  "川崎医科大学",
  "関西医科大学",
  "北里大学",
  "杏林大学",
  "近畿大学",
  "久留米大学",
  "慶應義塾大学",
  "国際医療福祉大学",
  "埼玉医科大学",
  "産業医科大学",
  "昭和大学",
  "自治医科大学",
  "順天堂大学",
  "聖マリアンナ医科大学",
  "帝京大学",
  "東海大学",
  "東京医科大学",
  "東京慈恵会医科大学",
  "東京女子医科大学",
  "東邦大学",
  "東北医科薬科大学",
  "獨協医科大学",
  "日本医科大学",
  "日本大学",
  "兵庫医科大学",
  "福岡大学",
  "藤田医科大学",
];

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
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  calendarChecklist: document.querySelector("#calendar-checklist"),
  yearGroups: document.querySelector("#year-groups"),
  addYearForm: document.querySelector("#add-year-form"),
  newYearLabel: document.querySelector("#new-year-label"),
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
  authError: document.querySelector("#auth-error"),
  pageTabBtns: document.querySelectorAll(".page-tab-btn"),
  pageTabPanels: document.querySelectorAll("[data-page-tab-panel]"),
  curriculumFilterForm: document.querySelector("#curriculum-filter-form"),
  curriculumName: document.querySelector("#curriculum-name"),
  curriculumYearSelect: document.querySelector("#curriculum-year-select"),
  curriculumTermSelect: document.querySelector("#curriculum-term-select"),
  curriculumTbody: document.querySelector("#curriculum-tbody"),
  goalLists: document.querySelectorAll(".goal-list"),
  openGoalsModalBtn: document.querySelector("#open-goals-modal"),
  goalModal: document.querySelector("#goal-modal"),
  goalModalCloseBtn: document.querySelector("#goal-modal-close"),
  goalEditLists: document.querySelectorAll(".goal-edit-list"),
  addGoalForms: document.querySelectorAll(".add-goal-form"),
  openSchoolsModalBtn: document.querySelector("#open-schools-modal"),
  schoolsModal: document.querySelector("#schools-modal"),
  schoolsModalCloseBtn: document.querySelector("#schools-modal-close"),
  schoolsSummary: document.querySelector("#schools-summary"),
  schoolsTabBtns: document.querySelectorAll(".schools-tab-btn"),
  schoolsTabPanels: document.querySelectorAll("[data-schools-tab-panel]"),
  privateSchoolChecklist: document.querySelector("#private-school-checklist"),
  addNationalSchoolForm: document.querySelector("#add-national-school-form"),
  newNationalSchoolInput: document.querySelector("#new-national-school"),
  nationalSchoolList: document.querySelector("#national-school-list"),
  rankSelects: document.querySelectorAll(".rank-select"),
  otherSchoolList: document.querySelector("#other-school-list"),
};

// 設定モーダル・目標モーダルはどちらも共通の.tab-btn/.modal-tab-panelクラスを使うため、
// document全体ではなく各モーダル内に絞ってクエリし、互いのタブ切り替えが干渉しないようにする。
els.tabBtns = els.settingsModal.querySelectorAll(".tab-btn");
els.tabPanels = els.settingsModal.querySelectorAll(".modal-tab-panel");
els.goalTabBtns = els.goalModal.querySelectorAll(".tab-btn");
els.goalTabPanels = els.goalModal.querySelectorAll(".modal-tab-panel");

let selectedCalendarIds = new Set();
let calendarColors = new Map(); // calendarId -> { raw, bg, fg }
let years = [];
let terms = [];
let selectedTermIds = new Set();
let editingYearId = null;
let editingTermId = null;
let rawEvents = [];
let nameFilter = null;
let eventViewMode = localStorage.getItem(EVENT_VIEW_KEY) === "calendar" ? "calendar" : "list";
let calendarCursor = startOfMonth(new Date());
let goals = [];
let candidateSchools = [];
let editingGoalId = null;

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

// --- ページ上部のタブ(授業予定 / カリキュラム作成) ---

els.pageTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.pageTabBtns.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    els.pageTabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.pageTabPanel !== btn.dataset.pageTab;
    });
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
  els.nameFilterLabel.textContent = "";
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
      await loadYears();
      await loadTerms();
      renderYearGroups();
      renderCurriculumYearOptions();
      restoreCurriculumState();
      if (els.curriculumName.value && els.curriculumTermSelect.value) {
        await loadCurriculumEvents();
      }
      if (els.curriculumName.value) {
        await loadGoals();
        await loadCandidateSchools();
      }
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
    calendars.map((c, i) => {
      const fallback = PASTEL_FALLBACK_COLORS[i % PASTEL_FALLBACK_COLORS.length];
      const raw = c.backgroundColor || fallback;
      const bg = c.backgroundColor ? lightenHexColor(c.backgroundColor, 0.72) : fallback;
      return [c.id, { raw, bg, fg: "#1f2937" }];
    })
  );
  renderCalendarChecklist(calendars);
}

// Googleカレンダーの色はそのままだと予定チップの背景としては濃すぎるため、
// 白と混ぜて薄くしたものを背景に使い、元の色は縁取り・スウォッチ用に残す。
function lightenHexColor(hex, amount) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function renderCalendarChecklist(calendars) {
  els.calendarChecklist.innerHTML = calendars
    .map((c) => {
      const checked = selectedCalendarIds.has(c.id) ? "checked" : "";
      const color = calendarColors.get(c.id);
      const dot = color
        ? `<span class="calendar-color-dot" style="background-color:${escapeHtml(color.raw)}"></span>`
        : "";
      return `<label class="calendar-item">
        <input type="checkbox" value="${escapeHtml(c.id)}" ${checked} />
        ${dot}${escapeHtml(c.summary || c.id)}
      </label>`;
    })
    .join("");
}

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

// --- 年度(academic_years)・学期(terms)。年度を親、学期を子とした階層で管理する ---
// デバイス間で共有し、学期を複数選択して予定を絞り込む。

async function loadYears() {
  years = await apiFetch("/years");
}

async function loadTerms() {
  terms = await apiFetch("/terms");
}

function renderYearGroups() {
  if (years.length === 0) {
    els.yearGroups.innerHTML = `<p class="hint">まだ年度が登録されていません。下のフォームから追加してください。</p>`;
    return;
  }
  els.yearGroups.innerHTML = years
    .map((y) => {
      const yearTerms = terms.filter((t) => t.year_id === y.id);
      const termsHtml = yearTerms.length
        ? yearTerms.map((t) => renderTermRow(t)).join("")
        : `<p class="hint">この年度にはまだ学期がありません。</p>`;
      const headerHtml =
        editingYearId === y.id
          ? `<form class="year-edit-form" data-year-id="${y.id}">
              <input type="text" class="edit-year-label" value="${escapeHtml(y.label)}" required />
              <div class="edit-actions">
                <button type="submit">保存</button>
                <button type="button" class="cancel-edit-year">キャンセル</button>
              </div>
            </form>`
          : `<div class="year-group-header">
              <h3>${escapeHtml(y.label)}</h3>
              <div class="year-actions">
                <button type="button" class="year-edit" data-id="${y.id}">編集</button>
                <button type="button" class="year-delete" data-id="${y.id}">削除</button>
              </div>
            </div>`;
      return `<div class="year-group">
        ${headerHtml}
        <div class="term-items">${termsHtml}</div>
        <form class="add-term-form" data-year-id="${y.id}">
          <input type="text" class="new-term-label" placeholder="例: 前期" required />
          <div class="term-dates">
            <input type="date" class="new-term-start" required />
            <span>〜</span>
            <input type="date" class="new-term-end" required />
          </div>
          <button type="submit">学期を追加</button>
        </form>
      </div>`;
    })
    .join("");
}

function renderTermRow(t) {
  const checked = selectedTermIds.has(t.id) ? "checked" : "";
  if (editingTermId === t.id) {
    return `<form class="term-edit-form" data-term-id="${t.id}">
      <input type="text" class="edit-term-label" value="${escapeHtml(t.label)}" required />
      <div class="term-dates">
        <input type="date" class="edit-term-start" value="${t.start_date}" required />
        <span>〜</span>
        <input type="date" class="edit-term-end" value="${t.end_date}" required />
      </div>
      <div class="edit-actions">
        <button type="submit">保存</button>
        <button type="button" class="cancel-edit-term">キャンセル</button>
      </div>
    </form>`;
  }
  return `<div class="term-item">
    <input type="checkbox" class="term-checkbox" value="${t.id}" ${checked} />
    <span class="term-item-label">${escapeHtml(t.label)}</span>
    <span class="term-item-dates">${t.start_date} 〜 ${t.end_date}</span>
    <button type="button" class="term-edit" data-id="${t.id}">編集</button>
    <button type="button" class="term-delete" data-id="${t.id}">削除</button>
  </div>`;
}

els.addYearForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const label = els.newYearLabel.value.trim();
  if (!label) return;
  try {
    await apiFetch("/years", { method: "POST", body: JSON.stringify({ label }) });
    els.newYearLabel.value = "";
    await loadYears();
    renderYearGroups();
  } catch (err) {
    showActionError(err);
  }
});

els.yearGroups.addEventListener("change", async (e) => {
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

els.yearGroups.addEventListener("click", async (e) => {
  const deleteTermBtn = e.target.closest(".term-delete");
  if (deleteTermBtn) {
    if (!confirm("この学期を削除しますか?")) return;
    try {
      await apiFetch(`/terms/${deleteTermBtn.dataset.id}`, { method: "DELETE" });
      selectedTermIds.delete(Number(deleteTermBtn.dataset.id));
      await loadTerms();
      renderYearGroups();
      await saveSelectedTerms();
      await loadCalendarEvents();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  const deleteYearBtn = e.target.closest(".year-delete");
  if (deleteYearBtn) {
    if (!confirm("この年度を削除しますか?(登録されている学期もすべて削除されます)")) return;
    try {
      await apiFetch(`/years/${deleteYearBtn.dataset.id}`, { method: "DELETE" });
      await loadYears();
      await loadTerms();
      renderYearGroups();
      await saveSelectedTerms();
      await loadCalendarEvents();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  const editYearBtn = e.target.closest(".year-edit");
  if (editYearBtn) {
    editingYearId = Number(editYearBtn.dataset.id);
    renderYearGroups();
    return;
  }

  const editTermBtn = e.target.closest(".term-edit");
  if (editTermBtn) {
    editingTermId = Number(editTermBtn.dataset.id);
    renderYearGroups();
    return;
  }

  if (e.target.closest(".cancel-edit-year")) {
    editingYearId = null;
    renderYearGroups();
    return;
  }

  if (e.target.closest(".cancel-edit-term")) {
    editingTermId = null;
    renderYearGroups();
  }
});

els.yearGroups.addEventListener("submit", async (e) => {
  const addForm = e.target.closest(".add-term-form");
  if (addForm) {
    e.preventDefault();
    els.actionError.textContent = "";
    const yearId = Number(addForm.dataset.yearId);
    const label = addForm.querySelector(".new-term-label").value.trim();
    const startDate = addForm.querySelector(".new-term-start").value;
    const endDate = addForm.querySelector(".new-term-end").value;
    if (!label || !startDate || !endDate) return;
    try {
      await apiFetch("/terms", {
        method: "POST",
        body: JSON.stringify({ year_id: yearId, label, start_date: startDate, end_date: endDate }),
      });
      await loadTerms();
      renderYearGroups();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  const yearEditForm = e.target.closest(".year-edit-form");
  if (yearEditForm) {
    e.preventDefault();
    els.actionError.textContent = "";
    const yearId = Number(yearEditForm.dataset.yearId);
    const label = yearEditForm.querySelector(".edit-year-label").value.trim();
    if (!label) return;
    try {
      await apiFetch(`/years/${yearId}`, { method: "PUT", body: JSON.stringify({ label }) });
      editingYearId = null;
      await loadYears();
      renderYearGroups();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  const termEditForm = e.target.closest(".term-edit-form");
  if (termEditForm) {
    e.preventDefault();
    els.actionError.textContent = "";
    const termId = Number(termEditForm.dataset.termId);
    const label = termEditForm.querySelector(".edit-term-label").value.trim();
    const startDate = termEditForm.querySelector(".edit-term-start").value;
    const endDate = termEditForm.querySelector(".edit-term-end").value;
    if (!label || !startDate || !endDate) return;
    try {
      await apiFetch(`/terms/${termId}`, {
        method: "PUT",
        body: JSON.stringify({ label, start_date: startDate, end_date: endDate }),
      });
      editingTermId = null;
      await loadTerms();
      renderYearGroups();
      await loadCalendarEvents();
    } catch (err) {
      showActionError(err);
    }
  }
});

// --- カリキュラム作成 ---
// 名前・年度・学期で絞り込んだGoogleカレンダーの予定を「第N回」として並べ、
// 完了チェックと3種類のメモをcalendar_event_id単位でD1に保存する。

function renderCurriculumYearOptions() {
  els.curriculumYearSelect.innerHTML =
    `<option value="">年度を選択</option>` +
    years.map((y) => `<option value="${y.id}">${escapeHtml(y.label)}</option>`).join("");
}

function renderCurriculumTermOptions(yearId) {
  const filtered = terms.filter((t) => t.year_id === yearId);
  els.curriculumTermSelect.innerHTML =
    `<option value="">学期を選択</option>` +
    filtered.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join("");
}

els.curriculumYearSelect.addEventListener("change", () => {
  renderCurriculumTermOptions(Number(els.curriculumYearSelect.value) || null);
});

function saveCurriculumState() {
  localStorage.setItem(
    CURRICULUM_STATE_KEY,
    JSON.stringify({
      name: els.curriculumName.value,
      yearId: els.curriculumYearSelect.value,
      termId: els.curriculumTermSelect.value,
    })
  );
}

function restoreCurriculumState() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(CURRICULUM_STATE_KEY) || "null");
  } catch {
    return;
  }
  if (!saved) return;
  els.curriculumName.value = saved.name || "";
  if (saved.yearId) {
    els.curriculumYearSelect.value = saved.yearId;
    renderCurriculumTermOptions(Number(saved.yearId));
    if (saved.termId) els.curriculumTermSelect.value = saved.termId;
  }
}

els.curriculumFilterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  saveCurriculumState();
  try {
    await loadCurriculumEvents();
    await loadGoals();
    await loadCandidateSchools();
  } catch (err) {
    showActionError(err);
  }
});

async function loadCurriculumEvents() {
  const token = getGoogleAccessToken();
  const name = els.curriculumName.value.trim();
  const term = terms.find((t) => t.id === Number(els.curriculumTermSelect.value));
  if (!token || !name || !term || selectedCalendarIds.size === 0) {
    els.curriculumTbody.innerHTML = "";
    return;
  }

  const timeMin = new Date(`${term.start_date}T00:00:00`).toISOString();
  const timeMax = new Date(`${term.end_date}T23:59:59`).toISOString();
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
      return data.items || [];
    })
  );

  const needle = name.toLowerCase();
  const matched = results
    .flat()
    .filter((ev) => `${ev.summary || ""} ${ev.description || ""}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      const aStart = a.start?.dateTime || a.start?.date || "";
      const bStart = b.start?.dateTime || b.start?.date || "";
      return aStart.localeCompare(bStart);
    });

  await renderCurriculumTable(matched);
}

async function renderCurriculumTable(events) {
  if (events.length === 0) {
    els.curriculumTbody.innerHTML = `<tr><td colspan="7">該当する予定がありません</td></tr>`;
    return;
  }

  const entries = await apiFetch("/curriculum");
  const entryMap = new Map(entries.map((entry) => [entry.calendar_event_id, entry]));

  els.curriculumTbody.innerHTML = events
    .map((ev, i) => {
      const saved = entryMap.get(ev.id) || {};
      const start = ev.start?.dateTime || ev.start?.date || "";
      const checked = saved.completed ? "checked" : "";
      return `<tr data-event-id="${escapeHtml(ev.id)}">
        <td><input type="checkbox" class="curriculum-completed" ${checked} /></td>
        <td>第${i + 1}回</td>
        <td>${formatDate(start)}</td>
        <td><textarea class="curriculum-plan" rows="2">${escapeHtml(saved.lesson_plan || "")}</textarea></td>
        <td><textarea class="curriculum-test" rows="2">${escapeHtml(saved.confirmation_test || "")}</textarea></td>
        <td><textarea class="curriculum-homework" rows="2">${escapeHtml(saved.homework || "")}</textarea></td>
        <td><textarea class="curriculum-memo" rows="2">${escapeHtml(saved.lesson_memo || "")}</textarea></td>
      </tr>`;
    })
    .join("");
}

els.curriculumTbody.addEventListener("change", async (e) => {
  const row = e.target.closest("tr[data-event-id]");
  if (!row) return;
  const eventId = row.dataset.eventId;
  const completed = row.querySelector(".curriculum-completed").checked;
  const lessonPlan = row.querySelector(".curriculum-plan").value;
  const confirmationTest = row.querySelector(".curriculum-test").value;
  const homework = row.querySelector(".curriculum-homework").value;
  const lessonMemo = row.querySelector(".curriculum-memo").value;
  try {
    await apiFetch(`/curriculum/${encodeURIComponent(eventId)}`, {
      method: "PUT",
      body: JSON.stringify({
        completed,
        lesson_plan: lessonPlan,
        confirmation_test: confirmationTest,
        homework,
        lesson_memo: lessonMemo,
      }),
    });
  } catch (err) {
    showActionError(err);
  }
});

// --- 目標(短期・中期・長期)。名前ごとにD1へ保存し、並べ替えはsort_orderの入れ替えで行う。
// ページ上のカラムでは完了チェックのみ操作でき、追加・編集・削除・並べ替えは目標モーダル(設定モーダルと同じ
// タブ構成)から行う。 ---

function goalsForCategory(category) {
  return goals.filter((g) => g.category === category).sort((a, b) => a.sort_order - b.sort_order);
}

// ページ上のカラム表示(チェックボックスのみ操作可能)
function renderGoalColumns() {
  els.goalLists.forEach((list) => {
    const category = list.dataset.category;
    const items = goalsForCategory(category);
    if (items.length === 0) {
      list.innerHTML = `<li class="hint">まだ目標がありません</li>`;
      return;
    }
    list.innerHTML = items
      .map(
        (g) => `<li class="goal-item${g.completed ? " completed" : ""}" data-goal-id="${g.id}">
          <input type="checkbox" class="goal-checkbox" ${g.completed ? "checked" : ""} />
          <span class="goal-item-text">${escapeHtml(g.text)}</span>
        </li>`
      )
      .join("");
  });
}

// 目標モーダル内の一覧表示(編集・削除・並べ替え)
function renderGoalEditLists() {
  els.goalEditLists.forEach((container) => {
    const category = container.dataset.category;
    const items = goalsForCategory(category);
    if (items.length === 0) {
      container.innerHTML = `<p class="hint">まだ目標がありません</p>`;
      return;
    }
    container.innerHTML = items
      .map((g, i) => {
        if (editingGoalId === g.id) {
          return `<form class="goal-edit-form" data-goal-id="${g.id}">
            <input type="text" class="edit-goal-text" value="${escapeHtml(g.text)}" required />
            <div class="edit-actions">
              <button type="submit">保存</button>
              <button type="button" class="cancel-edit-goal">キャンセル</button>
            </div>
          </form>`;
        }
        return `<div class="term-item" data-goal-id="${g.id}">
          <span class="term-item-label">${escapeHtml(g.text)}</span>
          <button type="button" class="goal-move-up" ${i === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="goal-move-down" ${i === items.length - 1 ? "disabled" : ""}>▼</button>
          <button type="button" class="goal-edit">編集</button>
          <button type="button" class="goal-delete">削除</button>
        </div>`;
      })
      .join("");
  });
}

async function loadGoals() {
  const name = els.curriculumName.value.trim();
  if (!name) {
    goals = [];
    renderGoalColumns();
    return;
  }
  goals = await apiFetch(`/goals?name=${encodeURIComponent(name)}`);
  renderGoalColumns();
}

els.openGoalsModalBtn.addEventListener("click", () => {
  const name = els.curriculumName.value.trim();
  if (!name) {
    showActionError(new Error("先に名前を入力してください"));
    return;
  }
  els.actionError.textContent = "";
  editingGoalId = null;
  renderGoalEditLists();
  els.goalModal.showModal();
});

els.goalModalCloseBtn.addEventListener("click", () => {
  editingGoalId = null;
  els.goalModal.close();
});

els.goalTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.goalTabBtns.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    els.goalTabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.goalTabPanel !== btn.dataset.goalTab;
    });
  });
});

els.goalLists.forEach((list) => {
  list.addEventListener("change", async (e) => {
    const checkbox = e.target.closest(".goal-checkbox");
    if (!checkbox) return;
    const li = e.target.closest("[data-goal-id]");
    const id = Number(li.dataset.goalId);
    try {
      await apiFetch(`/goals/${id}`, {
        method: "PUT",
        body: JSON.stringify({ completed: checkbox.checked }),
      });
      const g = goals.find((x) => x.id === id);
      if (g) g.completed = checkbox.checked ? 1 : 0;
      li.classList.toggle("completed", checkbox.checked);
    } catch (err) {
      showActionError(err);
    }
  });
});

els.addGoalForms.forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.actionError.textContent = "";
    const input = form.querySelector(".new-goal-text");
    const text = input.value.trim();
    const category = form.dataset.category;
    const name = els.curriculumName.value.trim();
    if (!text) return;
    try {
      await apiFetch("/goals", {
        method: "POST",
        body: JSON.stringify({ name, category, text }),
      });
      input.value = "";
      await loadGoals();
      renderGoalEditLists();
    } catch (err) {
      showActionError(err);
    }
  });
});

els.goalEditLists.forEach((container) => {
  container.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-goal-id]");
    if (!row) return;
    const id = Number(row.dataset.goalId);
    const g = goals.find((x) => x.id === id);
    if (!g) return;

    if (e.target.closest(".goal-edit")) {
      editingGoalId = id;
      renderGoalEditLists();
      return;
    }

    if (e.target.closest(".cancel-edit-goal")) {
      editingGoalId = null;
      renderGoalEditLists();
      return;
    }

    if (e.target.closest(".goal-delete")) {
      if (!confirm("この目標を削除しますか?")) return;
      try {
        await apiFetch(`/goals/${id}`, { method: "DELETE" });
        await loadGoals();
        renderGoalEditLists();
      } catch (err) {
        showActionError(err);
      }
      return;
    }

    const moveUp = e.target.closest(".goal-move-up");
    const moveDown = e.target.closest(".goal-move-down");
    if (moveUp || moveDown) {
      const items = goalsForCategory(g.category);
      const idx = items.findIndex((x) => x.id === id);
      const swapIdx = moveUp ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= items.length) return;
      const other = items[swapIdx];
      try {
        await Promise.all([
          apiFetch(`/goals/${g.id}`, { method: "PUT", body: JSON.stringify({ sort_order: other.sort_order }) }),
          apiFetch(`/goals/${other.id}`, { method: "PUT", body: JSON.stringify({ sort_order: g.sort_order }) }),
        ]);
        await loadGoals();
        renderGoalEditLists();
      } catch (err) {
        showActionError(err);
      }
    }
  });

  container.addEventListener("submit", async (e) => {
    const editForm = e.target.closest(".goal-edit-form");
    if (!editForm) return;
    e.preventDefault();
    els.actionError.textContent = "";
    const id = Number(editForm.dataset.goalId);
    const text = editForm.querySelector(".edit-goal-text").value.trim();
    if (!text) return;
    try {
      await apiFetch(`/goals/${id}`, { method: "PUT", body: JSON.stringify({ text }) });
      editingGoalId = null;
      await loadGoals();
      renderGoalEditLists();
    } catch (err) {
      showActionError(err);
    }
  });
});

// --- 受験校・志望校。私立医学部リストからの選択+国公立の自由入力、第1〜第3志望の設定 ---

function renderSchoolsSummary() {
  const name = els.curriculumName.value.trim();
  if (candidateSchools.length === 0) {
    els.schoolsSummary.textContent = name
      ? "まだ受験校が設定されていません。「設定」から登録してください。"
      : "名前を入力して「表示」を押すと設定できます。";
    return;
  }
  const ranked = [1, 2, 3]
    .map((rank) => candidateSchools.find((s) => s.rank === rank))
    .filter(Boolean)
    .map((s) => `第${s.rank}志望: ${s.school_name}`);
  const others = candidateSchools.filter((s) => !s.rank).map((s) => s.school_name);
  const parts = [];
  if (ranked.length) parts.push(ranked.join(" / "));
  if (others.length) parts.push(`その他: ${others.join("、")}`);
  els.schoolsSummary.textContent = parts.join("　|　") || "受験校が設定されています。";
}

async function loadCandidateSchools() {
  const name = els.curriculumName.value.trim();
  if (!name) {
    candidateSchools = [];
    renderSchoolsSummary();
    return;
  }
  candidateSchools = await apiFetch(`/schools?name=${encodeURIComponent(name)}`);
  renderSchoolsSummary();
}

function renderRankSelects() {
  const options = candidateSchools
    .map((s) => `<option value="${s.id}">${escapeHtml(s.school_name)}</option>`)
    .join("");
  els.rankSelects.forEach((select) => {
    const rank = Number(select.dataset.rank);
    const current = candidateSchools.find((s) => s.rank === rank);
    select.innerHTML = `<option value="">指定なし</option>` + options;
    select.value = current ? String(current.id) : "";
  });

  const others = candidateSchools.filter((s) => !s.rank);
  els.otherSchoolList.innerHTML = others.length
    ? others
        .map((s) => `<li class="term-item"><span class="term-item-label">${escapeHtml(s.school_name)}</span></li>`)
        .join("")
    : `<li class="hint">なし</li>`;
}

function renderSchoolsModal() {
  const selectedPrivate = new Set(
    candidateSchools.filter((s) => s.school_type === "private").map((s) => s.school_name)
  );
  els.privateSchoolChecklist.innerHTML = PRIVATE_MED_SCHOOLS.map((name) => {
    const checked = selectedPrivate.has(name) ? "checked" : "";
    return `<label class="calendar-item">
      <input type="checkbox" class="private-school-checkbox" value="${escapeHtml(name)}" ${checked} />
      ${escapeHtml(name)}
    </label>`;
  }).join("");

  const nationalSchools = candidateSchools.filter((s) => s.school_type === "national");
  els.nationalSchoolList.innerHTML = nationalSchools.length
    ? nationalSchools
        .map(
          (s) => `<li class="term-item" data-school-id="${s.id}">
            <span class="term-item-label">${escapeHtml(s.school_name)}</span>
            <button type="button" class="national-school-delete" data-id="${s.id}">削除</button>
          </li>`
        )
        .join("")
    : `<li class="hint">まだ登録されていません</li>`;

  renderRankSelects();
}

els.openSchoolsModalBtn.addEventListener("click", async () => {
  const name = els.curriculumName.value.trim();
  if (!name) {
    showActionError(new Error("先に名前を入力してください"));
    return;
  }
  els.actionError.textContent = "";
  try {
    await loadCandidateSchools();
    renderSchoolsModal();
    els.schoolsModal.showModal();
  } catch (err) {
    showActionError(err);
  }
});

els.schoolsModalCloseBtn.addEventListener("click", () => {
  els.schoolsModal.close();
  renderSchoolsSummary();
});

els.schoolsTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    els.schoolsTabBtns.forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
    els.schoolsTabPanels.forEach((panel) => {
      panel.hidden = panel.dataset.schoolsTabPanel !== btn.dataset.schoolsTab;
    });
    if (btn.dataset.schoolsTab === "rank") renderRankSelects();
  });
});

els.privateSchoolChecklist.addEventListener("change", async (e) => {
  const checkbox = e.target.closest(".private-school-checkbox");
  if (!checkbox) return;
  const name = els.curriculumName.value.trim();
  els.actionError.textContent = "";
  try {
    if (checkbox.checked) {
      await apiFetch("/schools", {
        method: "POST",
        body: JSON.stringify({ name, school_name: checkbox.value, school_type: "private" }),
      });
    } else {
      const existing = candidateSchools.find(
        (s) => s.school_type === "private" && s.school_name === checkbox.value
      );
      if (existing) await apiFetch(`/schools/${existing.id}`, { method: "DELETE" });
    }
    candidateSchools = await apiFetch(`/schools?name=${encodeURIComponent(name)}`);
    renderRankSelects();
  } catch (err) {
    showActionError(err);
  }
});

els.addNationalSchoolForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const name = els.curriculumName.value.trim();
  const schoolName = els.newNationalSchoolInput.value.trim();
  if (!schoolName) return;
  try {
    await apiFetch("/schools", {
      method: "POST",
      body: JSON.stringify({ name, school_name: schoolName, school_type: "national" }),
    });
    els.newNationalSchoolInput.value = "";
    candidateSchools = await apiFetch(`/schools?name=${encodeURIComponent(name)}`);
    renderSchoolsModal();
  } catch (err) {
    showActionError(err);
  }
});

els.nationalSchoolList.addEventListener("click", async (e) => {
  const deleteBtn = e.target.closest(".national-school-delete");
  if (!deleteBtn) return;
  els.actionError.textContent = "";
  try {
    await apiFetch(`/schools/${deleteBtn.dataset.id}`, { method: "DELETE" });
    const name = els.curriculumName.value.trim();
    candidateSchools = await apiFetch(`/schools?name=${encodeURIComponent(name)}`);
    renderSchoolsModal();
  } catch (err) {
    showActionError(err);
  }
});

els.rankSelects.forEach((select) => {
  select.addEventListener("change", async () => {
    const rank = Number(select.dataset.rank);
    const newId = select.value ? Number(select.value) : null;
    els.actionError.textContent = "";
    try {
      const previousHolder = candidateSchools.find((s) => s.rank === rank);
      if (previousHolder && previousHolder.id !== newId) {
        await apiFetch(`/schools/${previousHolder.id}`, { method: "PUT", body: JSON.stringify({ rank: null }) });
      }
      if (newId) {
        await apiFetch(`/schools/${newId}`, { method: "PUT", body: JSON.stringify({ rank }) });
      }
      const name = els.curriculumName.value.trim();
      candidateSchools = await apiFetch(`/schools?name=${encodeURIComponent(name)}`);
      renderRankSelects();
    } catch (err) {
      showActionError(err);
    }
  });
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
  return ` style="background-color:${escapeHtml(color.bg)};color:${escapeHtml(color.fg)};border-color:${escapeHtml(color.raw)}"`;
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
      return `<li class="event-item"${eventColorStyle(ev)}>
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
          return `<span class="cal-event"${eventColorStyle(ev)}>${escapeHtml(summaryRaw)}</span>`;
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

function applyNameFilter(token) {
  nameFilter = token;
  els.nameFilterLabel.textContent = token;
  els.nameFilterBar.hidden = false;
  renderCurrentView();
}

els.eventList.addEventListener("click", (e) => {
  const tokenEl = e.target.closest(".name-token");
  if (!tokenEl) return;
  applyNameFilter(tokenEl.dataset.token);
});

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
