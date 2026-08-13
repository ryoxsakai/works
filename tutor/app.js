import {
  watchAuth,
  signIn,
  signOutUser,
  getGoogleAccessToken,
} from "../shared/auth.js";

const API_BASE = "/api";
const SELECTED_CALENDARS_KEY = "works_selected_calendars";

const els = {
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  userEmail: document.querySelector("#user-email"),
  signInBtn: document.querySelector("#sign-in"),
  signOutBtn: document.querySelector("#sign-out"),
  actionError: document.querySelector("#action-error"),
  calendarChecklist: document.querySelector("#calendar-checklist"),
  studentSelect: document.querySelector("#student-select"),
  addStudentForm: document.querySelector("#add-student-form"),
  newStudentName: document.querySelector("#new-student-name"),
  newStudentTag: document.querySelector("#new-student-tag"),
  eventList: document.querySelector("#event-list"),
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
let selectedCalendarIds = loadSelectedCalendarIds();

function loadSelectedCalendarIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SELECTED_CALENDARS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveSelectedCalendarIds() {
  localStorage.setItem(SELECTED_CALENDARS_KEY, JSON.stringify([...selectedCalendarIds]));
}

function showActionError(err) {
  els.actionError.textContent = err instanceof Error ? err.message : String(err);
}

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
      await loadCalendarList();
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

async function loadCalendarList() {
  const token = getGoogleAccessToken();
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`カレンダー一覧の取得に失敗しました (${res.status})`);
  const data = await res.json();
  const calendars = data.items || [];
  renderCalendarChecklist(calendars);
}

function renderCalendarChecklist(calendars) {
  els.calendarChecklist.innerHTML = calendars
    .map((c) => {
      const checked = selectedCalendarIds.has(c.id) ? "checked" : "";
      return `<label class="calendar-item">
        <input type="checkbox" value="${escapeHtml(c.id)}" ${checked} />
        ${escapeHtml(c.summary || c.id)}
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
  saveSelectedCalendarIds();
  try {
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

async function loadCalendarEvents() {
  const token = getGoogleAccessToken();
  if (!token) {
    els.eventList.innerHTML = "<li>カレンダーへのアクセス許可を確認しています…</li>";
    return;
  }
  if (selectedCalendarIds.size === 0) {
    els.eventList.innerHTML = "<li>上でカレンダーを選択してください</li>";
    return;
  }

  const timeMin = new Date(Date.now() - 90 * 86400000).toISOString();
  const timeMax = new Date(Date.now() + 90 * 86400000).toISOString();
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

  let events = results.flat().sort((a, b) => {
    const aStart = a.start?.dateTime || a.start?.date || "";
    const bStart = b.start?.dateTime || b.start?.date || "";
    return aStart.localeCompare(bStart);
  });

  if (selectedStudent?.calendar_tag) {
    const tag = selectedStudent.calendar_tag.toLowerCase();
    events = events.filter((ev) =>
      `${ev.summary || ""} ${ev.description || ""}`.toLowerCase().includes(tag)
    );
  }
  renderEvents(events);
}

function renderEvents(events) {
  if (events.length === 0) {
    els.eventList.innerHTML = "<li>該当する授業予定がありません</li>";
    return;
  }
  els.eventList.innerHTML = events
    .map((ev) => {
      const start = ev.start?.dateTime || ev.start?.date || "";
      const summary = escapeHtml(ev.summary || "(無題)");
      return `<li>
        <button type="button" class="event-item" data-id="${ev.id}" data-summary="${summary}" data-start="${start}">
          ${formatDate(start)} — ${summary}
        </button>
      </li>`;
    })
    .join("");
}

els.eventList.addEventListener("click", (e) => {
  const btn = e.target.closest(".event-item");
  if (!btn || !selectedStudent) return;
  selectedEvent = {
    id: btn.dataset.id,
    summary: btn.dataset.summary,
    start: btn.dataset.start,
  };
  els.noteEventLabel.textContent = `${formatDate(selectedEvent.start)} — ${selectedEvent.summary}`;
  els.noteForm.hidden = false;
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
