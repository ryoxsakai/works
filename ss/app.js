import { getSessionToken, signOutUser, watchAuth } from "../shared/auth.js?v=11";

const STATUS_CLASSES = {
  "原稿待ち": "waiting",
  "素材案作成中": "drafting",
  "素材案確認待ち": "review",
  "問題作成中": "writing",
  "完了": "completed",
};

const STATUS_ORDER = {
  "原稿待ち": 0,
  "素材案作成中": 1,
  "素材案確認待ち": 2,
  "問題作成中": 3,
  "完了": 4,
};

const els = {
  signedIn: document.querySelector("#signed-in"),
  signOut: document.querySelector("#sign-out"),
  userBar: document.querySelector(".user-bar"),
  userAvatar: document.querySelector("#user-avatar"),
  userAvatarFallback: document.querySelector("#user-avatar-fallback"),
  error: document.querySelector("#ss-error"),
  list: document.querySelector("#ss-project-list"),
  empty: document.querySelector("#ss-empty"),
  summary: document.querySelector("#ss-summary"),
  sortButtons: [...document.querySelectorAll(".ss-sort-button")],
  sortKey: document.querySelector("#ss-sort-key"),
  sortDirection: document.querySelector("#ss-sort-direction"),
};

let projects = [];
let sortState = loadSortState();

function loadSortState() {
  try {
    const saved = JSON.parse(localStorage.getItem("works_ss_sort") || "null");
    if (["name", "status", "deadline", "remaining"].includes(saved?.key)
      && ["asc", "desc"].includes(saved?.direction)) {
      return saved;
    }
  } catch {
    // 破損した保存値は既定値へ戻す。
  }
  return { key: "deadline", direction: "asc" };
}

function setSort(key, direction) {
  sortState = { key, direction };
  localStorage.setItem("works_ss_sort", JSON.stringify(sortState));
  render();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}

function todayInJapan() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateNumber(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

function remainingDays(deadline) {
  return Math.round((dateNumber(deadline) - dateNumber(todayInJapan())) / 86_400_000);
}

function remaining(project) {
  if (project.status === "完了") return { text: "完了", className: "completed" };
  const days = remainingDays(project.deadline);
  if (!Number.isFinite(days)) return { text: "—", className: "" };
  if (days < 0) return { text: `${Math.abs(days)}日超過`, className: "overdue" };
  if (days === 0) return { text: "本日", className: "due-week-1" };
  if (days <= 7) return { text: `あと${days}日`, className: "due-week-1" };
  if (days <= 14) return { text: `あと${days}日`, className: "due-week-2" };
  if (days <= 21) return { text: `あと${days}日`, className: "due-week-3" };
  if (days <= 28) return { text: `あと${days}日`, className: "due-week-4" };
  return { text: `あと${days}日`, className: "due-beyond" };
}

function formatDate(value) {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Tokyo",
  }).format(date);
}

function sortValue(project, key) {
  if (key === "name") return String(project.name || "");
  if (key === "status") return STATUS_ORDER[project.status] ?? Number.MAX_SAFE_INTEGER;
  if (key === "deadline") return dateNumber(project.deadline);
  if (key === "remaining") return remainingDays(project.deadline);
  return "";
}

function sortedProjects() {
  const multiplier = sortState.direction === "desc" ? -1 : 1;
  return [...projects].sort((a, b) => {
    const left = sortValue(a, sortState.key);
    const right = sortValue(b, sortState.key);
    let result;
    if (typeof left === "string" || typeof right === "string") {
      result = String(left).localeCompare(String(right), "ja", { numeric: true, sensitivity: "base" });
    } else {
      result = Number(left) - Number(right);
    }
    return result === 0
      ? String(a.name || "").localeCompare(String(b.name || ""), "ja", { numeric: true })
      : result * multiplier;
  });
}

function renderSortControls() {
  els.sortKey.value = sortState.key;
  const ascending = sortState.direction === "asc";
  els.sortDirection.querySelector("span").textContent = ascending ? "昇順" : "降順";
  els.sortDirection.querySelector("i").className = `bx ${ascending ? "bx-sort-up" : "bx-sort-down"}`;
  els.sortDirection.setAttribute("aria-label", `${ascending ? "降順" : "昇順"}に切り替える`);

  for (const button of els.sortButtons) {
    const active = button.dataset.sortKey === sortState.key;
    const header = button.closest("th");
    header.setAttribute("aria-sort", active ? (ascending ? "ascending" : "descending") : "none");
    button.classList.toggle("active", active);
    button.querySelector("i").className = `bx ${active ? (ascending ? "bx-sort-up" : "bx-sort-down") : "bx-sort-alt-2"}`;
  }
}

function render() {
  const active = projects.filter((project) => project.status !== "完了").length;
  els.summary.textContent = projects.length ? `進行中 ${active}件／全${projects.length}件` : "";
  els.empty.hidden = projects.length > 0;
  renderSortControls();
  els.list.innerHTML = sortedProjects().map((project) => {
    const remainingState = remaining(project);
    const statusClass = STATUS_CLASSES[project.status] || "unknown";
    const memo = project.memo || "—";
    return `
      <tr>
        <td data-label="案件" class="ss-project-name">${escapeHtml(project.name)}</td>
        <td data-label="進捗"><span class="ss-status ss-status-${statusClass}">${escapeHtml(project.status)}</span></td>
        <td data-label="締切日" class="ss-deadline"><time datetime="${escapeHtml(project.deadline)}">${escapeHtml(formatDate(project.deadline))}</time></td>
        <td data-label="のこり期間"><span class="ss-remaining ${remainingState.className}">${escapeHtml(remainingState.text)}</span></td>
        <td data-label="メモ" class="ss-memo ${project.memo ? "" : "empty"}">${escapeHtml(memo)}</td>
      </tr>`;
  }).join("");
}

async function api(path) {
  const token = getSessionToken();
  if (!token) throw new Error("ログイン情報が見つかりません");
  const response = await fetch(`/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "SS案件の取得に失敗しました");
  return data;
}

async function loadProjects() {
  els.error.textContent = "";
  projects = await api("/ss-projects");
  render();
}

els.signOut.addEventListener("click", async () => {
  await signOutUser();
  window.location.assign("/");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && projects.length) render();
});

for (const button of els.sortButtons) {
  button.addEventListener("click", () => {
    const key = button.dataset.sortKey;
    setSort(key, sortState.key === key && sortState.direction === "asc" ? "desc" : "asc");
  });
}

els.sortKey.addEventListener("change", () => setSort(els.sortKey.value, "asc"));
els.sortDirection.addEventListener("click", () => {
  setSort(sortState.key, sortState.direction === "asc" ? "desc" : "asc");
});

watchAuth({
  onSignedIn: async ({ email, picture }) => {
    els.signedIn.hidden = false;
    els.userBar.hidden = false;
    els.signOut.title = `${email} (クリックでログアウト)`;
    if (picture) {
      els.userAvatar.src = picture;
      els.userAvatar.hidden = false;
      els.userAvatarFallback.hidden = true;
    } else {
      els.userAvatar.hidden = true;
      els.userAvatarFallback.hidden = false;
    }
    try {
      await loadProjects();
    } catch (error) {
      els.error.textContent = error instanceof Error ? error.message : String(error);
    }
  },
  onSignedOut: () => window.location.replace("/"),
});
