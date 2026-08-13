import { GOOGLE_CLIENT_ID, ALLOWED_EMAIL } from "./google-config.js?v=3";

// カレンダー読み取りとユーザー確認(email)の両方をこのスコープでまとめて取得する。
const SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly";

let accessToken = null;
let tokenClient = null;

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

// GISのトークンクライアントはページ再読み込みごとの自動復元を行わないため、
// リロードのたびに再ログインが必要になる(単一ユーザー運用なので許容)。
export async function watchAuth({ onSignedIn, onSignedOut }) {
  await loadGisScript();

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: SCOPES,
    hint: ALLOWED_EMAIL,
    callback: async (response) => {
      if (response.error) {
        accessToken = null;
        onSignedOut(`ログインに失敗しました: ${response.error}`);
        return;
      }
      try {
        const info = await fetchUserInfo(response.access_token);
        if (
          info.email?.toLowerCase() !== ALLOWED_EMAIL.toLowerCase() ||
          !info.email_verified
        ) {
          accessToken = null;
          onSignedOut(`許可されていないアカウントです: ${info.email}`);
          return;
        }
        accessToken = response.access_token;
        onSignedIn({ email: info.email });
      } catch (err) {
        accessToken = null;
        onSignedOut(err.message);
      }
    },
  });

  onSignedOut(null);
}

export function signIn() {
  tokenClient?.requestAccessToken();
}

export function signOutUser() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
}
