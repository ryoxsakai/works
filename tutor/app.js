import {
  watchAuth,
  signIn,
  signOutUser,
  getGoogleAccessToken,
  getSessionToken,
  isStandaloneHomeScreenApp,
} from "../shared/auth.js?v=11";
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
const ACTIVE_PAGE_TAB_KEY = "works_active_page_tab";
const CURRICULUM_STATE_KEY = "works_curriculum_state";
const COLLAPSED_SECTIONS_KEY = "works_collapsed_sections";
const PRINT_SECTIONS_KEY = "works_print_sections";
const DEFAULT_PRINT_SECTIONS = ["goals", "schools", "progress", "materials"];
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const TOKEN_DELIMITER_RE = /([\s　()()【】\[\]・/,、:：\-])/;

// summary/descriptionを名前として区切れる単位(スペースや括弧などの区切り文字)に分解する。
// 「田」のような部分一致で別の生徒(例: 田﨑)まで拾ってしまわないよう、
// カリキュラムの名前検索はこのトークンとの完全一致で判定する。
function tokenizeText(text) {
  return text
    .split(TOKEN_DELIMITER_RE)
    .filter((part) => part !== "" && !(part.length === 1 && TOKEN_DELIMITER_RE.test(part)));
}

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
  userBar: document.querySelector(".user-bar"),
  signInBtn: document.querySelector("#sign-in"),
  signOutBtn: document.querySelector("#sign-out"),
  userAvatar: document.querySelector("#user-avatar"),
  userAvatarFallback: document.querySelector("#user-avatar-fallback"),
  actionError: document.querySelector("#action-error"),
  openSettingsBtn: document.querySelector("#open-settings"),
  settingsModal: document.querySelector("#settings-modal"),
  settingsCloseBtn: document.querySelector("#settings-close"),
  themeRadios: document.querySelectorAll('input[name="theme"]'),
  calendarChecklist: document.querySelector("#calendar-checklist"),
  yearGroups: document.querySelector("#year-groups"),
  addYearForm: document.querySelector("#add-year-form"),
  newYearLabel: document.querySelector("#new-year-label"),
  addExcludedTitleForm: document.querySelector("#add-excluded-title-form"),
  newExcludedTitleInput: document.querySelector("#new-excluded-title"),
  excludedTitleList: document.querySelector("#excluded-title-list"),
  periodList: document.querySelector("#period-list"),
  addPeriodForm: document.querySelector("#add-period-form"),
  newPeriodLabel: document.querySelector("#new-period-label"),
  newPeriodStart: document.querySelector("#new-period-start"),
  materialList: document.querySelector("#material-list"),
  addMaterialForm: document.querySelector("#add-material-form"),
  newMaterialName: document.querySelector("#new-material-name"),
  materialChaptersModal: document.querySelector("#material-chapters-modal"),
  materialChaptersCloseBtn: document.querySelector("#material-chapters-close"),
  materialChaptersTitle: document.querySelector("#material-chapters-title"),
  chapterList: document.querySelector("#chapter-list"),
  addChapterForm: document.querySelector("#add-chapter-form"),
  newChapterName: document.querySelector("#new-chapter-name"),
  addStudentMaterialSelect: document.querySelector("#add-student-material-select"),
  addStudentMaterialBtn: document.querySelector("#add-student-material-btn"),
  studentMaterialsGrid: document.querySelector("#student-materials-grid"),
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
  listWeekNav: document.querySelector("#list-week-nav"),
  listWeekPrevBtn: document.querySelector("#list-week-prev"),
  listWeekNextBtn: document.querySelector("#list-week-next"),
  listWeekLabel: document.querySelector("#list-week-label"),
  scheduleWeekDays: document.querySelector("#schedule-week-days"),
  authError: document.querySelector("#auth-error"),
  pageTabBtns: document.querySelectorAll(".page-tab-btn"),
  pageTabPanels: document.querySelectorAll("[data-page-tab-panel]"),
  recordDayBtns: document.querySelectorAll(".record-day-btn"),
  recordDateLabel: document.querySelector("#record-date-label"),
  recordTbody: document.querySelector("#record-tbody"),
  curriculumFilterForm: document.querySelector("#curriculum-filter-form"),
  curriculumName: document.querySelector("#curriculum-name"),
  curriculumNameList: document.querySelector("#curriculum-name-list"),
  curriculumYearSelect: document.querySelector("#curriculum-year-select"),
  curriculumTermSelect: document.querySelector("#curriculum-term-select"),
  curriculumTbody: document.querySelector("#curriculum-tbody"),
  openCurriculumSearchModalBtn: document.querySelector("#open-curriculum-search-modal"),
  curriculumSearchModal: document.querySelector("#curriculum-search-modal"),
  curriculumSearchModalCloseBtn: document.querySelector("#curriculum-search-modal-close"),
  curriculumSearchSummary: document.querySelector("#curriculum-search-summary"),
  curriculumPrintNameInput: document.querySelector("#curriculum-print-name"),
  studentMemoInput: document.querySelector("#student-memo"),
  goalLists: document.querySelectorAll(".goal-list"),
  openGoalsModalBtn: document.querySelector("#open-goals-modal"),
  goalModal: document.querySelector("#goal-modal"),
  goalModalCloseBtn: document.querySelector("#goal-modal-close"),
  goalEditLists: document.querySelectorAll(".goal-edit-list"),
  addGoalForms: document.querySelectorAll(".add-goal-form"),
  goalTemplateLists: document.querySelectorAll(".goal-template-list"),
  addGoalTemplateForms: document.querySelectorAll(".add-goal-template-form"),
  openSchoolsModalBtn: document.querySelector("#open-schools-modal"),
  schoolsModal: document.querySelector("#schools-modal"),
  schoolsModalCloseBtn: document.querySelector("#schools-modal-close"),
  schoolsSummary: document.querySelector("#schools-summary"),
  schoolsTabPanels: document.querySelectorAll("[data-schools-tab-panel]"),
  privateSchoolChecklist: document.querySelector("#private-school-checklist"),
  addNationalSchoolForm: document.querySelector("#add-national-school-form"),
  newNationalSchoolInput: document.querySelector("#new-national-school"),
  nationalSchoolList: document.querySelector("#national-school-list"),
  rankSelects: document.querySelectorAll(".rank-select"),
  otherSchoolList: document.querySelector("#other-school-list"),
  printScheduleBtn: document.querySelector("#print-schedule"),
  printCurriculumBtn: document.querySelector("#print-curriculum"),
  curriculumPrintHeader: document.querySelector("#curriculum-print-header"),
};

// 設定モーダル・目標モーダルはどちらも共通の.tab-btn/.modal-tab-panelクラスを使うため、
// document全体ではなく各モーダル内に絞ってクエリし、互いのタブ切り替えが干渉しないようにする。
els.tabBtns = els.settingsModal.querySelectorAll(".tab-btn");
els.tabPanels = els.settingsModal.querySelectorAll(".modal-tab-panel");
els.goalTabBtns = els.goalModal.querySelectorAll(".tab-btn");
els.goalTabPanels = els.goalModal.querySelectorAll(".modal-tab-panel");
els.schoolsTabBtns = els.schoolsModal.querySelectorAll(".tab-btn");

let selectedCalendarIds = new Set();
let calendarColors = new Map(); // calendarId -> { raw, bg, fg }
let years = [];
let terms = [];
let selectedTermIds = new Set();
let excludedTitles = new Set();
let periods = [];
let editingPeriodId = null;
let materials = [];
let editingMaterialId = null;
let currentMaterialId = null;
let materialChapters = [];
let editingChapterId = null;
let studentMaterials = [];
let touchDragState = null;
let editingYearId = null;
let editingTermId = null;
let rawEvents = [];
let eventDetails = new Map();
let nameFilter = null;
// 授業予定は日付一覧から選ぶ詳細リストを標準表示にする。
let eventViewMode = localStorage.getItem(EVENT_VIEW_KEY) === "calendar" ? "calendar" : "list";
let calendarCursor = startOfMonth(new Date());
let listWeekCursor = startOfWeek(new Date());
let selectedScheduleDate = formatDateOnly(new Date());
let recordDayOffset = 0; // -1:前日 0:当日 1:翌日
let goals = [];
let candidateSchools = [];
let editingGoalId = null;
let goalTemplates = [];
let editingTemplateId = null;

function showActionError(err) {
  els.actionError.textContent = err instanceof Error ? err.message : String(err);
  els.actionError.classList.remove("info");
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// --- セクションの折りたたみ(アコーディオン) ---
// 印刷時は@media printで.accordion-body[hidden]を強制表示するため、
// ここでは画面表示用のhidden切り替えとlocalStorageへの保存のみ行う。

function loadCollapsedSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) || "[]");
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

const collapsedSections = loadCollapsedSections();

function applySectionState(id) {
  const toggle = document.querySelector(`[data-section-toggle="${id}"]`);
  const body = document.querySelector(`[data-section-body="${id}"]`);
  if (!toggle || !body) return;
  const collapsed = collapsedSections.has(id);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  body.hidden = collapsed;
}

function toggleSection(id) {
  if (collapsedSections.has(id)) {
    collapsedSections.delete(id);
  } else {
    collapsedSections.add(id);
  }
  localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections]));
  applySectionState(id);
}

document.querySelectorAll("[data-section-toggle]").forEach((toggle) => {
  const id = toggle.dataset.sectionToggle;
  applySectionState(id);
  toggle.addEventListener("click", () => toggleSection(id));
  toggle.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSection(id);
    }
  });
});

// --- セクションごとの印刷対象チェックボックス ---
// チェックを外したセクションは.no-printクラスを付け、@media printで非表示にする。
// 折りたたみ(画面表示)とは独立して、印刷に含めるかどうかだけを制御する。

function loadPrintSections() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRINT_SECTIONS_KEY) || "null");
    return new Set(Array.isArray(saved) ? saved : DEFAULT_PRINT_SECTIONS);
  } catch {
    return new Set(DEFAULT_PRINT_SECTIONS);
  }
}

const printSections = loadPrintSections();

function applyPrintSectionState(id) {
  const checkbox = document.querySelector(`[data-section-print="${id}"]`);
  const section = checkbox?.closest(".collapsible-section");
  if (!checkbox || !section) return;
  const included = printSections.has(id);
  checkbox.checked = included;
  section.classList.toggle("no-print", !included);
}

document.querySelectorAll("[data-section-print]").forEach((checkbox) => {
  const id = checkbox.dataset.sectionPrint;
  applyPrintSectionState(id);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      printSections.add(id);
    } else {
      printSections.delete(id);
    }
    localStorage.setItem(PRINT_SECTIONS_KEY, JSON.stringify([...printSections]));
    applyPrintSectionState(id);
  });
});

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

// --- ページ上部のタブ(授業記録 / 授業予定 / カリキュラム) ---

function setActivePageTab(tab) {
  const target = [...els.pageTabBtns].some((btn) => btn.dataset.pageTab === tab) ? tab : "record";
  els.pageTabBtns.forEach((btn) => btn.setAttribute("aria-selected", String(btn.dataset.pageTab === target)));
  els.pageTabPanels.forEach((panel) => {
    panel.hidden = panel.dataset.pageTabPanel !== target;
  });
  localStorage.setItem(ACTIVE_PAGE_TAB_KEY, target);
}

setActivePageTab(localStorage.getItem(ACTIVE_PAGE_TAB_KEY) || "record");

els.pageTabBtns.forEach((btn) => {
  btn.addEventListener("click", () => setActivePageTab(btn.dataset.pageTab));
});

// --- 授業記録。前日・当日・翌日にカレンダー上で見つかった予定を、
// 生徒名を事前登録せずカレンダーの内容だけから一覧化する。
// 回数(N/M回)は、同じタイトルの予定を対象日を含む学期(選択中の学期の中から)の
// 期間内で数えて算出する(該当する学期が無ければ前後90日をフォールバック範囲にする)。

function computeRecordTargetDate() {
  const d = new Date();
  d.setDate(d.getDate() + recordDayOffset);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderRecordDateLabel() {
  const d = computeRecordTargetDate();
  els.recordDateLabel.textContent = d.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

async function loadRecordTable() {
  renderRecordDateLabel();
  const token = getSessionToken();
  if (!token) {
    els.recordTbody.innerHTML = `<tr><td colspan="7">カレンダーへのアクセス許可を確認しています…</td></tr>`;
    return;
  }
  if (selectedCalendarIds.size === 0) {
    els.recordTbody.innerHTML = `<tr><td colspan="7">設定からカレンダーを選択してください</td></tr>`;
    return;
  }

  const targetDate = computeRecordTargetDate();
  const dayStr = formatDateOnly(targetDate);
  const dayEvents = (
    await fetchCalendarEvents(
      new Date(`${dayStr}T00:00:00`).toISOString(),
      new Date(`${dayStr}T23:59:59`).toISOString(),
      { withCalendarId: true }
    )
  ).sort((a, b) => {
    const aStart = a.start?.dateTime || a.start?.date || "";
    const bStart = b.start?.dateTime || b.start?.date || "";
    return aStart.localeCompare(bStart);
  });

  if (dayEvents.length === 0) {
    els.recordTbody.innerHTML = `<tr><td colspan="7">この日の予定はありません</td></tr>`;
    return;
  }

  const coveringTerm = terms.find(
    (t) => selectedTermIds.has(t.id) && dayStr >= t.start_date && dayStr <= t.end_date
  );
  let rangeStart, rangeEnd;
  if (coveringTerm) {
    rangeStart = coveringTerm.start_date;
    rangeEnd = coveringTerm.end_date;
  } else {
    rangeStart = formatDateOnly(new Date(targetDate.getTime() - 90 * 86400000));
    rangeEnd = formatDateOnly(new Date(targetDate.getTime() + 90 * 86400000));
  }
  const rangeEvents = await fetchCalendarEvents(
    new Date(`${rangeStart}T00:00:00`).toISOString(),
    new Date(`${rangeEnd}T23:59:59`).toISOString()
  );

  const entries = await apiFetch("/curriculum");
  const entryMap = new Map(entries.map((entry) => [entry.calendar_event_id, entry]));

  const rows = dayEvents.map((ev) => {
    const label = (ev.summary || "(無題)").trim();
    const sameLabelEvents = rangeEvents
      .filter((e) => (e.summary || "").trim() === label)
      .sort((a, b) => {
        const aStart = a.start?.dateTime || a.start?.date || "";
        const bStart = b.start?.dateTime || b.start?.date || "";
        return aStart.localeCompare(bStart);
      });
    const n = sameLabelEvents.findIndex((e) => e.id === ev.id) + 1;
    const m = sameLabelEvents.length;
    const saved = entryMap.get(ev.id) || {};
    const prevEvent = n > 1 ? sameLabelEvents[n - 2] : null;
    const prevSaved = prevEvent ? entryMap.get(prevEvent.id) || {} : {};
    return {
      eventId: ev.id,
      label,
      termId: coveringTerm ? coveringTerm.id : "",
      n: n || 1,
      m: m || 1,
      start: ev.start?.dateTime || ev.start?.date || "",
      iconColor: calendarColors.get(ev._calendarId)?.raw || "",
      completed: !!saved.completed,
      lessonPlan: saved.lesson_plan || "",
      confirmationTest: saved.confirmation_test || "",
      homework: saved.homework || "",
      lessonMemo: saved.lesson_memo || "",
      prevHomework: prevSaved.homework || "",
      prevLessonMemo: prevSaved.lesson_memo || "",
    };
  });

  renderRecordTable(rows);
}

function renderRecordTable(rows) {
  els.recordTbody.innerHTML = rows
    .map(
      (r) => `<tr data-event-id="${escapeHtml(r.eventId)}" data-completed="${r.completed ? 1 : 0}">
        <td>
          <button type="button" class="record-student-link" data-name="${escapeHtml(r.label)}" data-term-id="${r.termId}"><span class="record-avatar"${r.iconColor ? ` style="background-color:${escapeHtml(lightenHexColor(r.iconColor, 0.75))};color:${escapeHtml(r.iconColor)}"` : ""}><i class="fa-solid fa-book-open"></i></span> ${escapeHtml(r.label)}</button>
          ${
            r.prevHomework || r.prevLessonMemo
              ? `<div class="record-prev-info">
                  ${r.prevHomework ? `<p><i class="fa-solid fa-pencil"></i> ${escapeHtml(r.prevHomework)}</p>` : ""}
                  ${r.prevLessonMemo ? `<p><i class="fa-solid fa-note-sticky"></i> ${escapeHtml(r.prevLessonMemo)}</p>` : ""}
                </div>`
              : ""
          }
        </td>
        <td>${r.n}/${r.m}回</td>
        <td>${formatTimeOrPeriod(r.start)}</td>
        <td><textarea class="record-plan" rows="2">${escapeHtml(r.lessonPlan)}</textarea></td>
        <td><textarea class="record-test" rows="2">${escapeHtml(r.confirmationTest)}</textarea></td>
        <td><textarea class="record-homework" rows="2">${escapeHtml(r.homework)}</textarea></td>
        <td><textarea class="record-memo" rows="2">${escapeHtml(r.lessonMemo)}</textarea></td>
      </tr>`
    )
    .join("");
}

els.recordTbody.addEventListener("click", (e) => {
  const link = e.target.closest(".record-student-link");
  if (!link) return;
  const termId = Number(link.dataset.termId);
  const term = termId ? terms.find((t) => t.id === termId) : undefined;
  goToCurriculum(link.dataset.name, term);
});

els.recordTbody.addEventListener("change", async (e) => {
  const row = e.target.closest("tr[data-event-id]");
  if (!row) return;
  const eventId = row.dataset.eventId;
  const completed = row.dataset.completed === "1";
  const lessonPlan = row.querySelector(".record-plan").value;
  const confirmationTest = row.querySelector(".record-test").value;
  const homework = row.querySelector(".record-homework").value;
  const lessonMemo = row.querySelector(".record-memo").value;
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

els.recordDayBtns.forEach((btn) => {
  btn.addEventListener("click", async () => {
    recordDayOffset = { prev: -1, today: 0, next: 1 }[btn.dataset.day];
    els.recordDayBtns.forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    els.actionError.textContent = "";
    try {
      await loadRecordTable();
    } catch (err) {
      showActionError(err);
    }
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
  try {
    signIn();
  } catch (err) {
    els.authError.textContent = err.message;
  }
});

els.signOutBtn.addEventListener("click", async () => {
  await signOutUser();
  window.location.reload();
});

watchAuth({
  onSignedIn: async (user) => {
    els.signedOut.hidden = true;
    els.signedIn.hidden = false;
    els.userBar.hidden = false;
    els.signOutBtn.title = `${user.email} (クリックでログアウト)`;
    if (user.picture) {
      els.userAvatar.src = user.picture;
      els.userAvatar.hidden = false;
      els.userAvatarFallback.hidden = true;
    } else {
      els.userAvatar.hidden = true;
      els.userAvatarFallback.hidden = false;
    }
    els.actionError.textContent = "";
    try {
      await loadSettings();
    } catch (err) {
      showActionError(err);
    }
    // カレンダー一覧の取得はGoogle側の一時的な問題(API割り当て超過など)で
    // 失敗することがあるため、失敗しても他の初期化処理は続行する。
    try {
      await loadCalendarList();
    } catch (err) {
      showActionError(err);
    }
    try {
      await loadYears();
      await loadTerms();
      await loadGoalTemplates();
      await loadPeriods();
      await loadMaterials();
      renderYearGroups();
      renderExcludedTitleList();
      renderCurriculumYearOptions();
      restoreCurriculumState();
      renderCurriculumSearchSummary();
      if (els.curriculumName.value && els.curriculumTermSelect.value) {
        await loadCurriculumEvents();
      }
      if (els.curriculumName.value) {
        await loadGoals();
        await loadCandidateSchools();
        await loadStudentPref();
        await loadStudentMaterials();
      }
      await loadCalendarEvents();
      await loadRecordTable();
    } catch (err) {
      showActionError(err);
    }
  },
  onSignedOut: (message) => {
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
    els.userBar.hidden = true;
    els.authError.textContent =
      message ||
      (isStandaloneHomeScreenApp()
        ? "ホーム画面のアイコンから起動しています。ログインボタンを押すとSafariが開きます。ログイン後、このアイコンに戻ってきてください。"
        : "");
  },
});

async function apiFetch(path, options = {}) {
  const token = getSessionToken();
  if (!token) throw new Error("not signed in");
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    // セッションが失効している場合は静かにログアウトさせ、サインイン画面に戻す。
    await signOutUser();
    window.location.reload();
    throw new Error("セッションが切れました。再度ログインしてください。");
  }
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

// 選択中の全カレンダーから指定期間の予定を横断取得する共通ヘルパー。
// withCalendarId=trueのときは各予定に_calendarId(色分け用)を付与する。
async function fetchCalendarEvents(timeMin, timeMax, { withCalendarId = false } = {}) {
  const token = await getGoogleAccessToken();
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
      const items = data.items || [];
      return withCalendarId ? items.map((ev) => ({ ...ev, _calendarId: calendarId })) : items;
    })
  );
  return results.flat().filter((ev) => !excludedTitles.has((ev.summary || "").trim()));
}

function formatDateOnly(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// --- サーバー側設定(対象カレンダー。デバイス間で共有) ---

async function loadSettings() {
  const settings = await apiFetch("/settings");
  selectedCalendarIds = new Set(settings.selected_calendars || []);
  selectedTermIds = new Set(settings.selected_term_ids || []);
  excludedTitles = new Set(settings.excluded_titles || []);
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

// Google APIのエラーレスポンスから理由(reason/message)を取り出す。
// 403は原因(スコープ不足・API未有効化・割り当て超過など)が様々なため、
// 画面にそのまま出して原因特定しやすくする。
async function extractGoogleErrorDetail(res) {
  try {
    const data = await res.json();
    return data?.error?.message || data?.error?.errors?.[0]?.reason || "";
  } catch {
    return "";
  }
}

async function loadCalendarList() {
  const token = await getGoogleAccessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await extractGoogleErrorDetail(res);
    throw new Error(`カレンダー一覧の取得に失敗しました (${res.status})${detail ? `: ${detail}` : ""}`);
  }
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
    await loadRecordTable();
  } catch (err) {
    showActionError(err);
  }
});

// --- 表示しない予定(タイトル完全一致で除外。空き枠など) ---

function renderExcludedTitleList() {
  const items = [...excludedTitles];
  els.excludedTitleList.innerHTML = items.length
    ? items
        .map(
          (title) => `<li class="term-item" data-title="${escapeHtml(title)}">
            <span class="term-item-label">${escapeHtml(title)}</span>
            <button type="button" class="excluded-title-delete" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
          </li>`
        )
        .join("")
    : `<li class="hint">まだ登録されていません</li>`;
}

async function saveExcludedTitles() {
  await apiFetch("/settings", {
    method: "PUT",
    body: JSON.stringify({ excluded_titles: [...excludedTitles] }),
  });
}

els.addExcludedTitleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const title = els.newExcludedTitleInput.value.trim();
  if (!title) return;
  excludedTitles.add(title);
  els.newExcludedTitleInput.value = "";
  renderExcludedTitleList();
  try {
    await saveExcludedTitles();
    await loadCalendarEvents();
    await loadRecordTable();
  } catch (err) {
    showActionError(err);
  }
});

els.excludedTitleList.addEventListener("click", async (e) => {
  const deleteBtn = e.target.closest(".excluded-title-delete");
  if (!deleteBtn) return;
  const title = deleteBtn.closest("[data-title]")?.dataset.title;
  if (title === undefined) return;
  excludedTitles.delete(title);
  renderExcludedTitleList();
  try {
    await saveExcludedTitles();
    await loadCalendarEvents();
    await loadRecordTable();
  } catch (err) {
    showActionError(err);
  }
});

// --- 時限(○限)。時刻の範囲にラベルを付け、授業記録などで時刻の代わりに表示する ---

async function loadPeriods() {
  periods = await apiFetch("/periods");
  renderPeriodList();
}

function renderPeriodList() {
  if (periods.length === 0) {
    els.periodList.innerHTML = `<p class="hint">まだ時限が登録されていません。</p>`;
    return;
  }
  els.periodList.innerHTML = periods
    .map((p, i) => {
      if (editingPeriodId === p.id) {
        return `<form class="period-edit-form" data-period-id="${p.id}">
          <input type="text" class="edit-period-label" value="${escapeHtml(p.label)}" required />
          <input type="time" class="edit-period-start" value="${p.start_time}" required />
          <div class="edit-actions">
            <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="cancel-edit-period" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </form>`;
      }
      return `<div class="term-item" data-period-id="${p.id}">
        <span class="term-item-label">${escapeHtml(p.label)}</span>
        <span class="term-item-dates">${p.start_time} 〜</span>
        <button type="button" class="period-move-up" ${i === 0 ? "disabled" : ""} aria-label="上へ"><i class="fa-solid fa-chevron-up"></i></button>
        <button type="button" class="period-move-down" ${i === periods.length - 1 ? "disabled" : ""} aria-label="下へ"><i class="fa-solid fa-chevron-down"></i></button>
        <button type="button" class="period-edit" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="period-delete" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    })
    .join("");
}

els.addPeriodForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const label = els.newPeriodLabel.value.trim();
  const startTime = els.newPeriodStart.value;
  if (!label || !startTime) return;
  try {
    await apiFetch("/periods", {
      method: "POST",
      body: JSON.stringify({ label, start_time: startTime }),
    });
    els.newPeriodLabel.value = "";
    els.newPeriodStart.value = "";
    await loadPeriods();
    await loadRecordTable();
  } catch (err) {
    showActionError(err);
  }
});

els.periodList.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".period-edit");
  if (editBtn) {
    editingPeriodId = Number(editBtn.closest("[data-period-id]").dataset.periodId);
    renderPeriodList();
    return;
  }

  const deleteBtn = e.target.closest(".period-delete");
  if (deleteBtn) {
    if (!confirm("この時限を削除しますか?")) return;
    const id = Number(deleteBtn.closest("[data-period-id]").dataset.periodId);
    try {
      await apiFetch(`/periods/${id}`, { method: "DELETE" });
      await loadPeriods();
      await loadRecordTable();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  if (e.target.closest(".cancel-edit-period")) {
    editingPeriodId = null;
    renderPeriodList();
    return;
  }

  const moveUp = e.target.closest(".period-move-up");
  const moveDown = e.target.closest(".period-move-down");
  if (moveUp || moveDown) {
    const id = Number((moveUp || moveDown).closest("[data-period-id]").dataset.periodId);
    const idx = periods.findIndex((p) => p.id === id);
    const swapIdx = moveUp ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= periods.length) return;
    const a = periods[idx];
    const b = periods[swapIdx];
    try {
      await Promise.all([
        apiFetch(`/periods/${a.id}`, { method: "PUT", body: JSON.stringify({ sort_order: b.sort_order }) }),
        apiFetch(`/periods/${b.id}`, { method: "PUT", body: JSON.stringify({ sort_order: a.sort_order }) }),
      ]);
      await loadPeriods();
    } catch (err) {
      showActionError(err);
    }
  }
});

els.periodList.addEventListener("submit", async (e) => {
  const editForm = e.target.closest(".period-edit-form");
  if (!editForm) return;
  e.preventDefault();
  els.actionError.textContent = "";
  const id = Number(editForm.dataset.periodId);
  const label = editForm.querySelector(".edit-period-label").value.trim();
  const startTime = editForm.querySelector(".edit-period-start").value;
  if (!label || !startTime) return;
  try {
    await apiFetch(`/periods/${id}`, {
      method: "PUT",
      body: JSON.stringify({ label, start_time: startTime }),
    });
    editingPeriodId = null;
    await loadPeriods();
    await loadRecordTable();
  } catch (err) {
    showActionError(err);
  }
});

// --- 教材(設定タブ)。教材名を登録し、詳細アイコンからチャプター(章)を管理する ---

async function loadMaterials() {
  materials = await apiFetch("/materials");
  renderMaterialList();
}

function renderMaterialList() {
  if (materials.length === 0) {
    els.materialList.innerHTML = `<p class="hint">まだ教材が登録されていません。</p>`;
    return;
  }
  els.materialList.innerHTML = materials
    .map((m, i) => {
      if (editingMaterialId === m.id) {
        return `<form class="material-edit-form" data-material-id="${m.id}">
          <input type="text" class="edit-material-name" value="${escapeHtml(m.name)}" required />
          <div class="edit-actions">
            <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="cancel-edit-material" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </form>`;
      }
      return `<div class="term-item" data-material-id="${m.id}">
        <span class="term-item-label">${escapeHtml(m.name)}</span>
        <button type="button" class="material-move-up" ${i === 0 ? "disabled" : ""} aria-label="上へ"><i class="fa-solid fa-chevron-up"></i></button>
        <button type="button" class="material-move-down" ${i === materials.length - 1 ? "disabled" : ""} aria-label="下へ"><i class="fa-solid fa-chevron-down"></i></button>
        <button type="button" class="material-detail" aria-label="詳細"><i class="fa-solid fa-list-ol"></i></button>
        <button type="button" class="material-edit" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="material-delete" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    })
    .join("");
}

els.addMaterialForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const name = els.newMaterialName.value.trim();
  if (!name) return;
  try {
    await apiFetch("/materials", { method: "POST", body: JSON.stringify({ name }) });
    els.newMaterialName.value = "";
    await loadMaterials();
  } catch (err) {
    showActionError(err);
  }
});

els.materialList.addEventListener("click", async (e) => {
  const detailBtn = e.target.closest(".material-detail");
  if (detailBtn) {
    const id = Number(detailBtn.closest("[data-material-id]").dataset.materialId);
    const material = materials.find((m) => m.id === id);
    await openMaterialChaptersModal(id, material?.name || "");
    return;
  }

  const editBtn = e.target.closest(".material-edit");
  if (editBtn) {
    editingMaterialId = Number(editBtn.closest("[data-material-id]").dataset.materialId);
    renderMaterialList();
    return;
  }

  const deleteBtn = e.target.closest(".material-delete");
  if (deleteBtn) {
    if (!confirm("この教材を削除しますか?(登録済みのチャプターや生徒の進捗も削除されます)")) return;
    const id = Number(deleteBtn.closest("[data-material-id]").dataset.materialId);
    try {
      await apiFetch(`/materials/${id}`, { method: "DELETE" });
      await loadMaterials();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  if (e.target.closest(".cancel-edit-material")) {
    editingMaterialId = null;
    renderMaterialList();
    return;
  }

  const moveUp = e.target.closest(".material-move-up");
  const moveDown = e.target.closest(".material-move-down");
  if (moveUp || moveDown) {
    const id = Number((moveUp || moveDown).closest("[data-material-id]").dataset.materialId);
    const idx = materials.findIndex((m) => m.id === id);
    const swapIdx = moveUp ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= materials.length) return;
    const a = materials[idx];
    const b = materials[swapIdx];
    try {
      await Promise.all([
        apiFetch(`/materials/${a.id}`, { method: "PUT", body: JSON.stringify({ sort_order: b.sort_order }) }),
        apiFetch(`/materials/${b.id}`, { method: "PUT", body: JSON.stringify({ sort_order: a.sort_order }) }),
      ]);
      await loadMaterials();
    } catch (err) {
      showActionError(err);
    }
  }
});

els.materialList.addEventListener("submit", async (e) => {
  const editForm = e.target.closest(".material-edit-form");
  if (!editForm) return;
  e.preventDefault();
  els.actionError.textContent = "";
  const id = Number(editForm.dataset.materialId);
  const name = editForm.querySelector(".edit-material-name").value.trim();
  if (!name) return;
  try {
    await apiFetch(`/materials/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
    editingMaterialId = null;
    await loadMaterials();
  } catch (err) {
    showActionError(err);
  }
});

// --- 教材のチャプター(章)管理モーダル ---

async function openMaterialChaptersModal(materialId, materialName) {
  currentMaterialId = materialId;
  editingChapterId = null;
  els.materialChaptersTitle.textContent = materialName;
  try {
    await loadMaterialChapters();
  } catch (err) {
    showActionError(err);
  }
  els.materialChaptersModal.showModal();
}

async function loadMaterialChapters() {
  materialChapters = await apiFetch(`/materials/${currentMaterialId}/chapters`);
  renderMaterialChapterList();
}

function renderMaterialChapterList() {
  if (materialChapters.length === 0) {
    els.chapterList.innerHTML = `<p class="hint">まだチャプターが登録されていません。</p>`;
    return;
  }
  els.chapterList.innerHTML = materialChapters
    .map((c, i) => {
      if (editingChapterId === c.id) {
        return `<form class="chapter-edit-form" data-chapter-id="${c.id}">
          <input type="text" class="edit-chapter-name" value="${escapeHtml(c.name)}" required />
          <div class="edit-actions">
            <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="cancel-edit-chapter" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </form>`;
      }
      return `<div class="term-item" data-chapter-id="${c.id}">
        <span class="term-item-label">${escapeHtml(c.name)}</span>
        <button type="button" class="chapter-move-up" ${i === 0 ? "disabled" : ""} aria-label="上へ"><i class="fa-solid fa-chevron-up"></i></button>
        <button type="button" class="chapter-move-down" ${i === materialChapters.length - 1 ? "disabled" : ""} aria-label="下へ"><i class="fa-solid fa-chevron-down"></i></button>
        <button type="button" class="chapter-edit" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
        <button type="button" class="chapter-delete" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
      </div>`;
    })
    .join("");
}

els.materialChaptersCloseBtn.addEventListener("click", () => els.materialChaptersModal.close());

els.addChapterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  const name = els.newChapterName.value.trim();
  if (!name) return;
  try {
    await apiFetch(`/materials/${currentMaterialId}/chapters`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    els.newChapterName.value = "";
    await loadMaterialChapters();
  } catch (err) {
    showActionError(err);
  }
});

els.chapterList.addEventListener("click", async (e) => {
  const editBtn = e.target.closest(".chapter-edit");
  if (editBtn) {
    editingChapterId = Number(editBtn.closest("[data-chapter-id]").dataset.chapterId);
    renderMaterialChapterList();
    return;
  }

  const deleteBtn = e.target.closest(".chapter-delete");
  if (deleteBtn) {
    if (!confirm("このチャプターを削除しますか?")) return;
    const id = Number(deleteBtn.closest("[data-chapter-id]").dataset.chapterId);
    try {
      await apiFetch(`/chapters/${id}`, { method: "DELETE" });
      await loadMaterialChapters();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  if (e.target.closest(".cancel-edit-chapter")) {
    editingChapterId = null;
    renderMaterialChapterList();
    return;
  }

  const moveUp = e.target.closest(".chapter-move-up");
  const moveDown = e.target.closest(".chapter-move-down");
  if (moveUp || moveDown) {
    const id = Number((moveUp || moveDown).closest("[data-chapter-id]").dataset.chapterId);
    const idx = materialChapters.findIndex((c) => c.id === id);
    const swapIdx = moveUp ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= materialChapters.length) return;
    const a = materialChapters[idx];
    const b = materialChapters[swapIdx];
    try {
      await Promise.all([
        apiFetch(`/chapters/${a.id}`, { method: "PUT", body: JSON.stringify({ sort_order: b.sort_order }) }),
        apiFetch(`/chapters/${b.id}`, { method: "PUT", body: JSON.stringify({ sort_order: a.sort_order }) }),
      ]);
      await loadMaterialChapters();
    } catch (err) {
      showActionError(err);
    }
  }
});

els.chapterList.addEventListener("submit", async (e) => {
  const editForm = e.target.closest(".chapter-edit-form");
  if (!editForm) return;
  e.preventDefault();
  els.actionError.textContent = "";
  const id = Number(editForm.dataset.chapterId);
  const name = editForm.querySelector(".edit-chapter-name").value.trim();
  if (!name) return;
  try {
    await apiFetch(`/chapters/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
    editingChapterId = null;
    await loadMaterialChapters();
  } catch (err) {
    showActionError(err);
  }
});

// --- 生徒情報タブ: 教材・提出物進捗(使用教材の登録とチャプター単位の進捗チェック) ---

async function loadStudentMaterials() {
  const name = els.curriculumName.value.trim();
  if (!name) {
    studentMaterials = [];
    renderStudentMaterials();
    renderAddStudentMaterialOptions();
    return;
  }
  studentMaterials = await apiFetch(`/student-materials?name=${encodeURIComponent(name)}`);
  renderStudentMaterials();
  renderAddStudentMaterialOptions();
}

function renderAddStudentMaterialOptions() {
  const usedIds = new Set(studentMaterials.map((sm) => sm.material_id));
  const options = materials
    .filter((m) => !usedIds.has(m.id))
    .map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
    .join("");
  els.addStudentMaterialSelect.innerHTML = `<option value="">教材を選択...</option>${options}`;
}

function renderStudentMaterials() {
  if (studentMaterials.length === 0) {
    els.studentMaterialsGrid.innerHTML = `<p class="hint">まだ使用教材が登録されていません。</p>`;
    return;
  }
  els.studentMaterialsGrid.innerHTML = studentMaterials
    .map(
      (sm) => `<div class="material-block" draggable="true" data-student-material-id="${sm.id}">
        <div class="material-block-header">
          <i class="fa-solid fa-grip-lines material-drag-handle" aria-hidden="true"></i>
          <h4><i class="fa-solid fa-chevron-down material-chevron"></i> ${escapeHtml(sm.material_name)}</h4>
          <button type="button" class="material-block-remove" aria-label="この教材を外す"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <ul class="chapter-progress-list">
          ${sm.chapters
            .map(
              (c) => `<li>
                <label>
                  <input type="checkbox" class="chapter-progress-checkbox" data-chapter-id="${c.id}" ${c.completed ? "checked" : ""} />
                  <span${c.completed ? ' class="completed"' : ""}>${escapeHtml(c.name)}</span>
                </label>
              </li>`
            )
            .join("")}
        </ul>
      </div>`
    )
    .join("");
}

els.addStudentMaterialBtn.addEventListener("click", async () => {
  const materialId = Number(els.addStudentMaterialSelect.value);
  const name = els.curriculumName.value.trim();
  if (!materialId || !name) return;
  els.actionError.textContent = "";
  try {
    await apiFetch("/student-materials", {
      method: "POST",
      body: JSON.stringify({ name, material_id: materialId }),
    });
    await loadStudentMaterials();
  } catch (err) {
    showActionError(err);
  }
});

els.studentMaterialsGrid.addEventListener("click", async (e) => {
  const removeBtn = e.target.closest(".material-block-remove");
  if (removeBtn) {
    if (!confirm("この教材を生徒から外しますか?(進捗の記録は保持されます)")) return;
    const id = Number(removeBtn.closest(".material-block").dataset.studentMaterialId);
    try {
      await apiFetch(`/student-materials/${id}`, { method: "DELETE" });
      await loadStudentMaterials();
    } catch (err) {
      showActionError(err);
    }
    return;
  }

  // 教材名(サブヘッダー)をタップすると、チャプター一覧の折りたたみを切り替える。
  if (e.target.closest(".material-block-header")) {
    e.target.closest(".material-block")?.classList.toggle("collapsed");
  }
});

els.studentMaterialsGrid.addEventListener("change", async (e) => {
  const checkbox = e.target.closest(".chapter-progress-checkbox");
  if (!checkbox) return;
  const chapterId = Number(checkbox.dataset.chapterId);
  const completed = checkbox.checked;
  checkbox.parentElement.querySelector("span")?.classList.toggle("completed", completed);
  const name = els.curriculumName.value.trim();
  try {
    await apiFetch(`/chapter-progress/${chapterId}`, {
      method: "PUT",
      body: JSON.stringify({ name, completed }),
    });
  } catch (err) {
    showActionError(err);
  }
});

// 使用教材(サブヘッダー)の並べ替え。PCはネイティブドラッグ&ドロップ、
// タッチ端末はタップアンドホールド(長押し)で開始する。
async function persistStudentMaterialsOrder() {
  const ids = [...els.studentMaterialsGrid.querySelectorAll(".material-block")].map((el) =>
    Number(el.dataset.studentMaterialId)
  );
  const name = els.curriculumName.value.trim();
  try {
    await apiFetch("/student-materials/reorder", {
      method: "PUT",
      body: JSON.stringify({ name, order: ids }),
    });
    studentMaterials.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  } catch (err) {
    showActionError(err);
  }
}

function reorderBlockAt(draggingId, clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY)?.closest(".material-block");
  const dragging = els.studentMaterialsGrid.querySelector(
    `[data-student-material-id="${draggingId}"]`
  );
  if (!target || !dragging || target === dragging) return;
  const rect = target.getBoundingClientRect();
  const after = clientY - rect.top > rect.height / 2;
  target.parentNode.insertBefore(dragging, after ? target.nextSibling : target);
}

let draggingStudentMaterialId = null;

els.studentMaterialsGrid.addEventListener("dragstart", (e) => {
  const block = e.target.closest(".material-block");
  if (!block) return;
  draggingStudentMaterialId = block.dataset.studentMaterialId;
  e.dataTransfer.effectAllowed = "move";
  block.classList.add("dragging");
});

els.studentMaterialsGrid.addEventListener("dragover", (e) => {
  if (!draggingStudentMaterialId) return;
  e.preventDefault();
  reorderBlockAt(draggingStudentMaterialId, e.clientX, e.clientY);
});

els.studentMaterialsGrid.addEventListener("dragend", async (e) => {
  const block = e.target.closest(".material-block");
  block?.classList.remove("dragging");
  if (draggingStudentMaterialId) {
    draggingStudentMaterialId = null;
    await persistStudentMaterialsOrder();
  }
});

els.studentMaterialsGrid.addEventListener(
  "touchstart",
  (e) => {
    const header = e.target.closest(".material-block-header");
    if (!header || e.target.closest(".material-block-remove")) return;
    const block = header.closest(".material-block");
    const touch = e.touches[0];
    touchDragState = {
      id: block.dataset.studentMaterialId,
      startX: touch.clientX,
      startY: touch.clientY,
      dragging: false,
      timer: setTimeout(() => {
        if (!touchDragState) return;
        touchDragState.dragging = true;
        block.classList.add("dragging");
        if (navigator.vibrate) navigator.vibrate(15);
      }, 450),
    };
  },
  { passive: true }
);

els.studentMaterialsGrid.addEventListener(
  "touchmove",
  (e) => {
    if (!touchDragState) return;
    const touch = e.touches[0];
    if (!touchDragState.dragging) {
      if (
        Math.abs(touch.clientX - touchDragState.startX) > 10 ||
        Math.abs(touch.clientY - touchDragState.startY) > 10
      ) {
        clearTimeout(touchDragState.timer);
        touchDragState = null;
      }
      return;
    }
    e.preventDefault();
    reorderBlockAt(touchDragState.id, touch.clientX, touch.clientY);
  },
  { passive: false }
);

els.studentMaterialsGrid.addEventListener("touchend", async () => {
  if (!touchDragState) return;
  clearTimeout(touchDragState.timer);
  const state = touchDragState;
  touchDragState = null;
  if (state.dragging) {
    document
      .querySelector(`[data-student-material-id="${state.id}"]`)
      ?.classList.remove("dragging");
    await persistStudentMaterialsOrder();
  }
});

// 時限は開始時刻だけを持ち、次の時限の開始時刻の直前までをその時限とみなす。
// 並び順(sort_order)は設定画面の表示順のためだけのものなので、判定はstart_timeで
// 都度ソートし直してから行う。
function findPeriodLabel(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const t = `${hh}:${mm}`;
  const sorted = [...periods].sort((a, b) => a.start_time.localeCompare(b.start_time));
  let match = null;
  for (const p of sorted) {
    if (p.start_time > t) break;
    match = p;
  }
  return match ? match.label : null;
}

function formatTimeOrPeriod(iso) {
  const periodLabel = findPeriodLabel(iso);
  if (periodLabel) return periodLabel;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

// カリキュラム表の日付欄用: mm/dd (曜) 時限(登録がなければ時刻)。
function formatCurriculumDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const weekday = WEEKDAY_LABELS[d.getDay()];
  return `${mm}/${dd} (${weekday}) ${formatTimeOrPeriod(iso)}`;
}

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
                <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
                <button type="button" class="cancel-edit-year" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
              </div>
            </form>`
          : `<div class="year-group-header">
              <h3>${escapeHtml(y.label)}</h3>
              <div class="year-actions">
                <button type="button" class="year-edit" data-id="${y.id}" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="year-delete" data-id="${y.id}" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
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
          <button type="submit" class="btn-add" aria-label="学期を追加"><i class="fa-solid fa-plus"></i></button>
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
        <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
        <button type="button" class="cancel-edit-term" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </form>`;
  }
  return `<div class="term-item">
    <input type="checkbox" class="term-checkbox" value="${t.id}" ${checked} />
    <span class="term-item-label">${escapeHtml(t.label)}</span>
    <span class="term-item-dates">${t.start_date} 〜 ${t.end_date}</span>
    <button type="button" class="term-edit" data-id="${t.id}" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
    <button type="button" class="term-delete" data-id="${t.id}" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
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
    await loadRecordTable();
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
      await loadRecordTable();
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
      await loadRecordTable();
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
      await loadRecordTable();
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

// 生徒(name)ごとの印刷名前(検索名とは別に、印刷時だけ自由な表記(例: 田﨑くん)を使える)。
async function loadStudentPref() {
  const name = els.curriculumName.value.trim();
  if (!name) {
    els.curriculumPrintNameInput.value = "";
    els.studentMemoInput.value = "";
    return;
  }
  const pref = await apiFetch(`/student-prefs?name=${encodeURIComponent(name)}`);
  els.curriculumPrintNameInput.value = pref?.print_name || "";
  els.studentMemoInput.value = pref?.memo || "";
}

els.curriculumPrintNameInput.addEventListener("change", async () => {
  const name = els.curriculumName.value.trim();
  if (!name) {
    showActionError(new Error("先に名前を検索してください"));
    return;
  }
  try {
    await apiFetch("/student-prefs", {
      method: "PUT",
      body: JSON.stringify({ name, print_name: els.curriculumPrintNameInput.value.trim() || null }),
    });
  } catch (err) {
    showActionError(err);
  }
});

els.studentMemoInput.addEventListener("change", async () => {
  const name = els.curriculumName.value.trim();
  if (!name) {
    showActionError(new Error("先に名前を検索してください"));
    return;
  }
  try {
    await apiFetch("/student-prefs", {
      method: "PUT",
      body: JSON.stringify({ name, memo: els.studentMemoInput.value.trim() || null }),
    });
  } catch (err) {
    showActionError(err);
  }
});

// ページ上部の検索バーに、現在絞り込み中の名前・年度・学期を表示する。
function renderCurriculumSearchSummary() {
  const name = els.curriculumName.value.trim();
  if (!name) {
    els.curriculumSearchSummary.textContent = "名前を検索してください。";
    return;
  }
  const yearLabel = els.curriculumYearSelect.selectedOptions[0]?.textContent || "";
  const termLabel = els.curriculumTermSelect.selectedOptions[0]?.textContent || "";
  els.curriculumSearchSummary.textContent = [name, yearLabel, termLabel].filter(Boolean).join("　/　");
}

els.openCurriculumSearchModalBtn.addEventListener("click", () => {
  els.curriculumSearchModal.showModal();
});

els.curriculumSearchModalCloseBtn.addEventListener("click", () => els.curriculumSearchModal.close());

// 名前入力欄の候補(datalist)を、現在読み込まれている授業予定(rawEvents)のタイトル・説明を
// トークン化して作る。D1に別途登録する方式ではなく、カレンダーの内容から直接候補を出すことで、
// カリキュラム側で一度も検索していない名前や、直近マッチが0件だった名前も候補に出せる。
function renderCurriculumNameSuggestions() {
  const tokens = new Set();
  rawEvents.forEach((ev) => {
    tokenizeText(`${ev.summary || ""} ${ev.description || ""}`).forEach((t) => tokens.add(t));
  });
  els.curriculumNameList.innerHTML = [...tokens]
    .sort()
    .map((t) => `<option value="${escapeHtml(t)}"></option>`)
    .join("");
}

els.curriculumFilterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.actionError.textContent = "";
  saveCurriculumState();
  try {
    await loadCurriculumEvents();
    await loadGoals();
    await loadCandidateSchools();
    await loadStudentPref();
    await loadStudentMaterials();
    renderCurriculumSearchSummary();
    els.curriculumSearchModal.close();
  } catch (err) {
    showActionError(err);
  }
});

async function loadCurriculumEvents() {
  const token = getSessionToken();
  const name = els.curriculumName.value.trim();
  const term = terms.find((t) => t.id === Number(els.curriculumTermSelect.value));
  if (!token || !name || !term || selectedCalendarIds.size === 0) {
    els.curriculumTbody.innerHTML = "";
    return;
  }

  const timeMin = new Date(`${term.start_date}T00:00:00`).toISOString();
  const timeMax = new Date(`${term.end_date}T23:59:59`).toISOString();
  const events = await fetchCalendarEvents(timeMin, timeMax);

  const matched = events
    .filter((ev) => tokenizeText(`${ev.summary || ""} ${ev.description || ""}`).includes(name))
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
      return `<tr data-event-id="${escapeHtml(ev.id)}" data-completed="${saved.completed ? 1 : 0}">
        <td><input type="checkbox" class="curriculum-completed" ${checked} /></td>
        <td>第${i + 1}回</td>
        <td>${formatCurriculumDate(start)}</td>
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
  row.dataset.completed = completed ? "1" : "0";
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
              <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
              <button type="button" class="cancel-edit-goal" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
            </div>
          </form>`;
        }
        return `<div class="term-item" data-goal-id="${g.id}">
          <span class="term-item-label">${escapeHtml(g.text)}</span>
          <button type="button" class="goal-move-up" ${i === 0 ? "disabled" : ""} aria-label="上へ"><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" class="goal-move-down" ${i === items.length - 1 ? "disabled" : ""} aria-label="下へ"><i class="fa-solid fa-chevron-down"></i></button>
          <button type="button" class="goal-edit" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="goal-delete" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
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
  editingTemplateId = null;
  renderGoalEditLists();
  renderGoalTemplateLists();
  els.goalModal.showModal();
});

els.goalModalCloseBtn.addEventListener("click", () => {
  editingGoalId = null;
  editingTemplateId = null;
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

// 目標テンプレート。生徒名に紐付かず短期・中期・長期ごとに使い回す文言集で、
// 「追加」ボタンを押すと現在選択中の生徒の目標としてコピーされる。

function templatesForCategory(category) {
  return goalTemplates
    .filter((t) => t.category === category)
    .sort((a, b) => a.sort_order - b.sort_order);
}

function renderGoalTemplateLists() {
  els.goalTemplateLists.forEach((container) => {
    const category = container.dataset.category;
    const items = templatesForCategory(category);
    if (items.length === 0) {
      container.innerHTML = `<p class="hint">まだテンプレートがありません</p>`;
      return;
    }
    container.innerHTML = items
      .map((t, i) => {
        if (editingTemplateId === t.id) {
          return `<form class="template-edit-form" data-template-id="${t.id}">
            <input type="text" class="edit-template-text" value="${escapeHtml(t.text)}" required />
            <div class="edit-actions">
              <button type="submit" class="btn-primary" aria-label="保存"><i class="fa-solid fa-check"></i></button>
              <button type="button" class="cancel-edit-template" aria-label="キャンセル"><i class="fa-solid fa-xmark"></i></button>
            </div>
          </form>`;
        }
        return `<div class="term-item" data-template-id="${t.id}">
          <span class="term-item-label">${escapeHtml(t.text)}</span>
          <button type="button" class="template-move-up" ${i === 0 ? "disabled" : ""} aria-label="上へ"><i class="fa-solid fa-chevron-up"></i></button>
          <button type="button" class="template-move-down" ${i === items.length - 1 ? "disabled" : ""} aria-label="下へ"><i class="fa-solid fa-chevron-down"></i></button>
          <button type="button" class="template-use" aria-label="目標として追加"><i class="fa-solid fa-plus"></i></button>
          <button type="button" class="template-edit" aria-label="編集"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="template-delete" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
        </div>`;
      })
      .join("");
  });
}

async function loadGoalTemplates() {
  goalTemplates = await apiFetch("/goal-templates");
  renderGoalTemplateLists();
}

els.addGoalTemplateForms.forEach((form) => {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    els.actionError.textContent = "";
    const input = form.querySelector(".new-goal-template-text");
    const text = input.value.trim();
    const category = form.dataset.category;
    if (!text) return;
    try {
      await apiFetch("/goal-templates", {
        method: "POST",
        body: JSON.stringify({ category, text }),
      });
      input.value = "";
      await loadGoalTemplates();
    } catch (err) {
      showActionError(err);
    }
  });
});

els.goalTemplateLists.forEach((container) => {
  container.addEventListener("click", async (e) => {
    const row = e.target.closest("[data-template-id]");
    if (!row) return;
    const id = Number(row.dataset.templateId);
    const t = goalTemplates.find((x) => x.id === id);
    if (!t) return;

    if (e.target.closest(".template-use")) {
      try {
        const name = els.curriculumName.value.trim();
        await apiFetch("/goals", {
          method: "POST",
          body: JSON.stringify({ name, category: t.category, text: t.text }),
        });
        await loadGoals();
        renderGoalEditLists();
      } catch (err) {
        showActionError(err);
      }
      return;
    }

    if (e.target.closest(".template-edit")) {
      editingTemplateId = id;
      renderGoalTemplateLists();
      return;
    }

    if (e.target.closest(".cancel-edit-template")) {
      editingTemplateId = null;
      renderGoalTemplateLists();
      return;
    }

    if (e.target.closest(".template-delete")) {
      if (!confirm("このテンプレートを削除しますか?")) return;
      try {
        await apiFetch(`/goal-templates/${id}`, { method: "DELETE" });
        await loadGoalTemplates();
      } catch (err) {
        showActionError(err);
      }
      return;
    }

    const moveUp = e.target.closest(".template-move-up");
    const moveDown = e.target.closest(".template-move-down");
    if (moveUp || moveDown) {
      const items = templatesForCategory(t.category);
      const idx = items.findIndex((x) => x.id === id);
      const swapIdx = moveUp ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= items.length) return;
      const other = items[swapIdx];
      try {
        await Promise.all([
          apiFetch(`/goal-templates/${t.id}`, {
            method: "PUT",
            body: JSON.stringify({ sort_order: other.sort_order }),
          }),
          apiFetch(`/goal-templates/${other.id}`, {
            method: "PUT",
            body: JSON.stringify({ sort_order: t.sort_order }),
          }),
        ]);
        await loadGoalTemplates();
      } catch (err) {
        showActionError(err);
      }
    }
  });

  container.addEventListener("submit", async (e) => {
    const editForm = e.target.closest(".template-edit-form");
    if (!editForm) return;
    e.preventDefault();
    els.actionError.textContent = "";
    const id = Number(editForm.dataset.templateId);
    const text = editForm.querySelector(".edit-template-text").value.trim();
    if (!text) return;
    try {
      await apiFetch(`/goal-templates/${id}`, { method: "PUT", body: JSON.stringify({ text }) });
      editingTemplateId = null;
      await loadGoalTemplates();
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
            <button type="button" class="national-school-delete" data-id="${s.id}" aria-label="削除"><i class="fa-solid fa-trash"></i></button>
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

// --- 印刷モード。授業予定・カリキュラムそれぞれに印刷ボタンを設置し、
// 印刷時はCSS(@media print)でフォーム・タブ・設定ボタン等の操作UIを非表示にする。
// カリキュラム表のtextareaは行数固定だと複数行の内容が印刷時に見切れるため、
// 印刷直前に内容の高さへ自動調整する。

// iOS Safari等では、ユーザー操作(クリック)から非同期に切り離すと
// window.print()が無反応になることがあるため、必ずクリックハンドラ内で
// 同期的に呼び出す(requestAnimationFrame等での遅延は行わない)。
function triggerPrint() {
  // 一部のモバイル環境ではwindow.print()が無反応(エラーも出さず何も起きない)
  // ことがあるため、まずボタンのクリック自体は届いていることを画面上で確認できる
  // ようにする。
  els.actionError.textContent = "印刷を呼び出しました…反応がない場合はブラウザの共有/印刷メニューをお試しください";
  els.actionError.classList.add("info");
  if (typeof window.print !== "function") {
    showActionError(new Error("この環境では印刷機能(window.print)がサポートされていません"));
    return;
  }
  try {
    window.print();
  } catch (err) {
    showActionError(err);
  }
}

els.printScheduleBtn.addEventListener("click", () => triggerPrint());

els.printCurriculumBtn.addEventListener("click", () => {
  const name = els.curriculumName.value.trim();
  const displayName = els.curriculumPrintNameInput.value.trim() || name;
  const yearLabel = els.curriculumYearSelect.selectedOptions[0]?.textContent || "";
  const termLabel = els.curriculumTermSelect.selectedOptions[0]?.textContent || "";
  els.curriculumPrintHeader.textContent = [displayName, yearLabel, termLabel].filter(Boolean).join("　/　");
  triggerPrint();
});

window.addEventListener("beforeprint", () => {
  els.curriculumTbody.querySelectorAll("textarea").forEach((t) => {
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight}px`;
  });
});

window.addEventListener("afterprint", () => {
  els.curriculumTbody.querySelectorAll("textarea").forEach((t) => {
    t.style.height = "";
  });
  els.actionError.textContent = "";
  els.actionError.classList.remove("info");
});

// --- 授業予定の取得・絞り込み・表示 ---

async function loadCalendarEvents() {
  const token = getSessionToken();
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
  const events = await fetchCalendarEvents(timeMin, timeMax, { withCalendarId: true });

  rawEvents = events.sort((a, b) => {
    const aStart = a.start?.dateTime || a.start?.date || "";
    const bStart = b.start?.dateTime || b.start?.date || "";
    return aStart.localeCompare(bStart);
  });
  // カードに授業予定・宿題・授業メモを表示するため、既存の進行記録を対応付ける。
  const curriculumEntries = await apiFetch("/curriculum");
  eventDetails = new Map(curriculumEntries.map((entry) => [entry.calendar_event_id, entry]));

  renderCurriculumNameSuggestions();
  renderCurrentView();
}

function showEventPlaceholder(message) {
  els.calendarView.hidden = true;
  els.eventList.hidden = false;
  els.listWeekNav.hidden = true;
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
  return ` style="--item-accent:${escapeHtml(color.raw)}"`;
}

// トークンのテキスト部分をクリックするとカリキュラムでその名前を検索し、
// 隣接するフィルタアイコンをクリックするとその場(授業予定)で絞り込む。
// 個々の単語(トークン)はカリキュラム遷移用にクリック可能なテキストとして残すが、
// 絞り込みは1単語ごとではなく元のタイトル全体(全単語)を対象にする。
// そのため絞り込みアイコンは各予定につき1つだけ、末尾にまとめて置く。
function renderTokenizedSummary(summary) {
  const fullText = summary.trim();
  const tokensHtml = summary
    .split(TOKEN_DELIMITER_RE)
    .filter((part) => part !== "")
    .map((part) => {
      if (TOKEN_DELIMITER_RE.test(part) && part.length === 1) return escapeHtml(part);
      return `<span class="name-token-text" data-token="${escapeHtml(part)}">${escapeHtml(part)}</span>`;
    })
    .join("");
  return `${tokensHtml}<button type="button" class="name-token-filter" data-token="${escapeHtml(fullText)}" aria-label="「${escapeHtml(fullText)}」で絞り込み"><i class="fa-solid fa-filter"></i></button>`;
}

function handleTokenClick(e) {
  const filterBtn = e.target.closest(".name-token-filter, .event-filter-menu");
  if (filterBtn) {
    applyNameFilter(filterBtn.dataset.token);
    return;
  }
  const textEl = e.target.closest(".name-token-text");
  if (textEl) {
    goToCurriculum(textEl.dataset.token);
  }
}

function startOfWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function formatWeekLabel(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_LABELS[d.getDay()]})`;
}

function formatEventTime(ev) {
  if (!ev.start?.dateTime) return "終日";
  return new Date(ev.start.dateTime).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderScheduleWeekDays(weekStart) {
  const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
  els.listWeekLabel.textContent = `${formatWeekLabel(weekStart)} 〜 ${formatWeekLabel(weekEnd)}`;
  if (!selectedScheduleDate || selectedScheduleDate < formatDateOnly(weekStart) || selectedScheduleDate > formatDateOnly(weekEnd)) {
    const today = formatDateOnly(new Date());
    selectedScheduleDate = today >= formatDateOnly(weekStart) && today <= formatDateOnly(weekEnd)
      ? today
      : formatDateOnly(weekStart);
  }
  els.scheduleWeekDays.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart.getTime() + i * 86400000);
    const value = formatDateOnly(date);
    const selected = value === selectedScheduleDate;
    return `<button type="button" class="schedule-day-btn" aria-pressed="${selected}" data-date="${value}" aria-label="${formatWeekLabel(date)}">
      <span>${WEEKDAY_LABELS[date.getDay()]}</span><strong>${date.getDate()}</strong>
    </button>`;
  }).join("");
}

function renderListView(events) {
  els.calendarView.hidden = true;
  els.eventList.hidden = false;
  els.listWeekNav.hidden = false;

  const weekStart = listWeekCursor;
  renderScheduleWeekDays(weekStart);
  const dayEvents = events
    .filter((ev) => {
      const start = ev.start?.dateTime || ev.start?.date || "";
      return start.slice(0, 10) === selectedScheduleDate;
    })
    .sort((a, b) => (a.start?.dateTime || a.start?.date || "").localeCompare(b.start?.dateTime || b.start?.date || ""));

  if (dayEvents.length === 0) {
    els.eventList.innerHTML = `<li class="schedule-empty">${formatWeekLabel(new Date(`${selectedScheduleDate}T00:00:00`))}の授業予定はありません</li>`;
    return;
  }

  els.eventList.innerHTML = dayEvents.map((ev) => {
    const detail = eventDetails.get(ev.id) || {};
    const summary = (ev.summary || "(無題)").trim();
    const plan = detail.lesson_plan || "未入力";
    const homework = detail.homework || "未入力";
    const memo = detail.lesson_memo || "未入力";
    return `<li class="event-item"${eventColorStyle(ev)}>
      <div class="event-time"><span>${formatEventTime(ev)}</span><small>${escapeHtml(findPeriodLabel(ev.start?.dateTime) || "")}</small></div>
      <div class="event-main">
        <button type="button" class="event-student-name name-token-text" data-token="${escapeHtml(summary)}">${escapeHtml(summary)}</button>
        <dl class="event-details">
          <div><dt>授業予定</dt><dd>${escapeHtml(plan)}</dd></div>
          <div><dt>宿題</dt><dd>${escapeHtml(homework)}</dd></div>
          <div><dt>授業メモ</dt><dd>${escapeHtml(memo)}</dd></div>
        </dl>
      </div>
      <button type="button" class="event-filter-menu" data-token="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}で絞り込む"><i class="fa-solid fa-filter"></i></button>
    </li>`;
  }).join("");
}

function renderCalendarView(events) {
  els.eventList.hidden = true;
  els.listWeekNav.hidden = true;
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
          const summary = (ev.summary || "(無題)").trim();
          return `<button type="button" class="cal-event name-token-text"${eventColorStyle(ev)} data-token="${escapeHtml(summary)}" aria-label="${escapeHtml(summary)}の生徒情報を開く">
            <span class="cal-event-time">${formatEventTime(ev)}</span><span>${escapeHtml(summary)}</span>
          </button>`;
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

// 授業予定・授業記録の生徒名をクリックしたときの遷移先。
// カリキュラムタブに切り替え、その名前(・分かればその学期)で検索を実行する。
async function goToCurriculum(name, term) {
  const curriculumTabBtn = [...els.pageTabBtns].find((b) => b.dataset.pageTab === "curriculum");
  curriculumTabBtn?.click();
  els.curriculumName.value = name;
  if (term) {
    els.curriculumYearSelect.value = term.year_id;
    renderCurriculumTermOptions(term.year_id);
    els.curriculumTermSelect.value = term.id;
  }
  els.actionError.textContent = "";
  saveCurriculumState();
  try {
    await loadCurriculumEvents();
    await loadGoals();
    await loadCandidateSchools();
    await loadStudentPref();
    await loadStudentMaterials();
    renderCurriculumSearchSummary();
  } catch (err) {
    showActionError(err);
  }
}

els.eventList.addEventListener("click", handleTokenClick);
els.calendarGrid.addEventListener("click", handleTokenClick);

els.listWeekPrevBtn.addEventListener("click", () => {
  listWeekCursor = new Date(listWeekCursor.getTime() - 7 * 86400000);
  selectedScheduleDate = formatDateOnly(listWeekCursor);
  renderCurrentView();
});

els.listWeekNextBtn.addEventListener("click", () => {
  listWeekCursor = new Date(listWeekCursor.getTime() + 7 * 86400000);
  selectedScheduleDate = formatDateOnly(listWeekCursor);
  renderCurrentView();
});

els.scheduleWeekDays.addEventListener("click", (e) => {
  const btn = e.target.closest(".schedule-day-btn");
  if (!btn) return;
  selectedScheduleDate = btn.dataset.date;
  renderCurrentView();
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
