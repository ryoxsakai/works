import {
  watchAuth,
  signIn,
  signOutUser,
  getGoogleAccessToken,
  getIdToken,
} from "../shared/auth.js";

const API_BASE = "/api";

const els = {
  signedOut: document.querySelector("#signed-out"),
  signedIn: document.querySelector("#signed-in"),
  userEmail: document.querySelector("#user-email"),
  signInBtn: document.querySelector("#sign-in"),
  signOutBtn: document.querySelector("#sign-out"),
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
    await loadStudents();
    await loadCalendarEvents();
  },
  onSignedOut: () => {
    els.signedOut.hidden = false;
    els.signedIn.hidden = true;
  },
  onError: (err) => {
    els.authError.textContent = "ログインに失敗しました: " + err.message;
  },
});

async function apiFetch(path, options = {}) {
  const idToken = await getIdToken();
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

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
  await loadCalendarEvents();
  await loadNotes();
});

els.addStudentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = els.newStudentName.value.trim();
  const tag = els.newStudentTag.value.trim();
  if (!name) return;
  await apiFetch("/students", {
    method: "POST",
    body: JSON.stringify({ name, calendar_tag: tag }),
  });
  els.newStudentName.value = "";
  els.newStudentTag.value = "";
  await loadStudents();
});

async function loadCalendarEvents() {
  const token = getGoogleAccessToken();
  if (!token) {
    els.eventList.innerHTML = "<li>カレンダーへのアクセス許可を確認しています…</li>";
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
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    els.eventList.innerHTML = `<li>カレンダー取得に失敗しました (${res.status})</li>`;
    return;
  }
  const data = await res.json();
  let events = data.items || [];
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
  if (!selectedStudent || !selectedEvent) return;
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
