import { GOOGLE_CLIENT_ID, ALLOWED_EMAIL } from "./google-config.js?v=4";

// カレンダー読み取りとユーザー確認(email)の両方をこのスコープでまとめて取得する。
const SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly";

// works.lrnr.jp 配下の全ページで共有されるキー。
// ここに保存しておくことで、他のモジュールに移動してもログイン状態を引き継げる(ワンログイン)。
const STORAGE_KEY = "works_google_token";

let accessToken = null;
let tokenClient = null;
let isInteractiveAttempt = false;

function loadStoredToken() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!data?.access_token || !data.expires_at || data.expires_at <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function storeToken(access_token, expires_in) {
  const expires_at = Date.now() + (expires_in - 60) * 1000;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token, expires_at }));
}

function clearStoredToken() {
  localStorage.removeItem(STORAGE_KEY);
}

function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Servicesの読み込みに失敗しました"));
    document.head.appendChild(script);
  });
}

async function fetchUserInfo(token) {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("ユーザー情報の取得に失敗しました");
  return res.json();
}

export function getGoogleAccessToken() {
  return accessToken;
}

export async function watchAuth({ onSignedIn, onSignedOut }) {
  await loadGisScript();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    hint: ALLOWED_EMAIL,
    callback: async (response) => {
      const wasInteractive = isInteractiveAttempt;
      isInteractiveAttempt = false;

      if (response.error) {
        accessToken = null;
        clearStoredToken();
        // サイレント再認証(ページ読み込み時の自動試行)の失敗は、
        // 単にログインボタンを出すだけで静かに扱う。
        onSignedOut(wasInteractive ? `ログインに失敗しました: ${response.error}` : null);
        return;
      }
      try {
        const info = await fetchUserInfo(response.access_token);
        if (
          info.email?.toLowerCase() !== ALLOWED_EMAIL.toLowerCase() ||
          !info.email_verified
        ) {
          accessToken = null;
          clearStoredToken();
          onSignedOut(`許可されていないアカウントです: ${info.email}`);
          return;
        }
        accessToken = response.access_token;
        storeToken(response.access_token, response.expires_in);
        onSignedIn({ email: info.email });
      } catch (err) {
        accessToken = null;
        clearStoredToken();
        onSignedOut(err.message);
      }
    },
  });

  const stored = loadStoredToken();
  if (stored) {
    try {
      const info = await fetchUserInfo(stored.access_token);
      if (info.email?.toLowerCase() === ALLOWED_EMAIL.toLowerCase() && info.email_verified) {
        accessToken = stored.access_token;
        onSignedIn({ email: info.email });
        return;
      }
    } catch {
      // 失効等で検証に失敗した場合は、下のサイレント再認証にフォールバックする。
    }
    clearStoredToken();
  }

  // 保存された有効なトークンが無い場合、ユーザー操作なしで再認証を試みる。
  // 既にGoogleにログイン済み・同意済みであれば無言で復帰できる。
  isInteractiveAttempt = false;
  tokenClient.requestAccessToken({ prompt: "none" });
}

export function signIn() {
  isInteractiveAttempt = true;
  tokenClient?.requestAccessToken();
}

export function signOutUser() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  clearStoredToken();
}
