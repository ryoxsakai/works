import { GOOGLE_CLIENT_ID, ALLOWED_EMAIL } from "./google-config.js?v=5";

// カレンダー読み取りとユーザー確認(email)の両方をこのスコープでまとめて取得する。
const SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly";

// works.lrnr.jp 配下の全ページで共有されるキー。
// ここに保存しておくことで、他のモジュールに移動してもログイン状態を引き継げる(ワンログイン)。
const SESSION_STORAGE_KEY = "works_session_token";

const API_BASE = "/api";

let sessionToken = null;
let cachedGoogleToken = null; // { access_token, expires_at }
let googleTokenPromise = null; // 同時に複数箇所から呼ばれても1回のリクエストにまとめる

function redirectUri() {
  const u = new URL(window.location.href);
  u.search = "";
  u.hash = "";
  return u.toString();
}

function loadStoredSession() {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function storeSession(token) {
  localStorage.setItem(SESSION_STORAGE_KEY, token);
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function fetchUserInfo(token) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("ユーザー情報の取得に失敗しました");
  return res.json();
}

async function exchangeAuthCode(code) {
  const res = await fetch(`${API_BASE}/auth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: redirectUri() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ログインに失敗しました (${res.status})`);
  return data;
}

export function getSessionToken() {
  return sessionToken;
}

// Googleカレンダーを直接呼ぶためのアクセストークンを取得する。
// このWorkerがサーバー側で保存しているリフレッシュトークンを使って都度発行するため、
// ブラウザ側のタブ状態やサードパーティCookie制限に左右されない。
// 短時間の間に複数箇所から呼ばれても、キャッシュ・同時リクエストの合流で1回で済ませる。
export async function getGoogleAccessToken() {
  if (!sessionToken) return null;
  if (cachedGoogleToken && cachedGoogleToken.expires_at > Date.now() + 30_000) {
    return cachedGoogleToken.access_token;
  }
  if (!googleTokenPromise) {
    googleTokenPromise = fetch(`${API_BASE}/google-token`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Googleトークンの取得に失敗しました (${res.status})`);
        const data = await res.json();
        cachedGoogleToken = {
          access_token: data.access_token,
          expires_at: Date.now() + data.expires_in * 1000,
        };
        return cachedGoogleToken.access_token;
      })
      .finally(() => {
        googleTokenPromise = null;
      });
  }
  return googleTokenPromise;
}

export async function watchAuth({ onSignedIn, onSignedOut }) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthError = params.get("error");

  if (code || oauthError) {
    // 戻る/リロードで同じcodeが再送されないよう、先にURLから消しておく。
    window.history.replaceState({}, "", window.location.pathname);
  }

  if (oauthError) {
    onSignedOut(oauthError === "access_denied" ? null : `ログインに失敗しました: ${oauthError}`);
    return;
  }

  if (code) {
    try {
      const data = await exchangeAuthCode(code);
      sessionToken = data.session_token;
      storeSession(sessionToken);
    } catch (err) {
      sessionToken = null;
      clearStoredSession();
      onSignedOut(err.message);
      return;
    }
  } else {
    sessionToken = loadStoredSession();
  }

  if (!sessionToken) {
    onSignedOut(null);
    return;
  }

  try {
    const googleToken = await getGoogleAccessToken();
    const info = await fetchUserInfo(googleToken);
    onSignedIn({ email: info.email, picture: info.picture });
  } catch (err) {
    sessionToken = null;
    cachedGoogleToken = null;
    clearStoredSession();
    onSignedOut(null);
  }
}

export function signIn() {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // 毎回同意画面を出すことで、確実にrefresh_tokenを取得し直せるようにする。
    prompt: "consent",
    login_hint: ALLOWED_EMAIL,
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function signOutUser() {
  try {
    if (sessionToken) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
    }
  } catch {
    // サーバー側の失効に失敗しても、ローカルの状態は必ずクリアする。
  }
  sessionToken = null;
  cachedGoogleToken = null;
  clearStoredSession();
}
