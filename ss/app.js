import { getSessionToken, signOutUser, watchAuth } from "../shared/auth.js?v=11";

const STATUS_CLASSES = {
  "原稿待ち": "waiting",
  "素材案作成中": "drafting",
  "素材案確認待ち": "review",
  "問題作成中": "writing",
  "完了": "completed",
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
};

let projects = [];

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
  if (days > 0) return { text: `あと${days}日`, className: days <= 3 ? "urgent" : "" };
  if (days === 0) return { text: "本日", className: "urgent" };
  return { text: `${Math.abs(days)}日超過`, className: "overdue" };
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

function render() {
  const active = projects.filter((project) => project.status !== "完了").length;
  els.summary.textContent = projects.length ? `進行中 ${active}件／全${projects.length}件` : "";
  els.empty.hidden = projects.length > 0;
  els.list.innerHTML = projects.map((project) => {
    const remainingState = remaining(project);
    const statusClass = STATUS_CLASSES[project.status] || "unknown";
    return `
      <tr>
        <td data-label="プロジェクト名" class="ss-project-name">${escapeHtml(project.name)}</td>
        <td data-label="ステータス"><span class="ss-status ss-status-${statusClass}">${escapeHtml(project.status)}</span></td>
        <td data-label="締切日" class="ss-deadline"><time datetime="${escapeHtml(project.deadline)}">${escapeHtml(formatDate(project.deadline))}</time></td>
        <td data-label="のこり期間"><span class="ss-remaining ${remainingState.className}">${escapeHtml(remainingState.text)}</span></td>
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
