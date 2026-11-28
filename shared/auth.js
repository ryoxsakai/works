import { GOOGLE_CLIENT_ID, ALLOWED_EMAIL } from "./google-config.js?v=5";

// カレンダー読み取り・ToDoのカレンダー反映、Google ToDo リスト同期(tasks)、ユーザー確認(email)をまとめて取得する。
const SCOPES = "openid email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks";

// works.lrnr.jp 配下の全ページで共有されるキー。
// ここに保存しておくことで、他のモジュールに移動してもログイン状態を引き継げる(ワンログイン)。
const SESSION_STORAGE_KEY = "works_session_token";

const API_BASE = "/api";

let sessionToken = null;
let cachedGoogleToken = null; // { access_token, expires_at }
let googleTokenPromise = null; // 同時に複数箇所から呼ばれても1回のリクエストにまとめる

function redirectUri(pathname = window.location.pathname) {
  const u = new URL(pathname, window.location.origin);
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
export async function getGoogleAccessToken({signal=AbortSignal.timeout(15000)}={}) {
  if(signal.aborted)throw signal.reason||new DOMException('Read aborted','AbortError');
  if (!sessionToken) return null;
  if (cachedGoogleToken && cachedGoogleToken.expires_at > Date.now() + 30_000) {
    return cachedGoogleToken.access_token;
  }
  if (!googleTokenPromise) {
    const cancel=()=>{if(googleTokenPromise===request)googleTokenPromise=null;};
    const request = fetch(`${API_BASE}/google-token`, {
      headers: { Authorization: `Bearer ${sessionToken}` },signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Googleトークンの取得に失敗しました (${res.status})`);
        const data = await res.json();
        // A late response from an aborted attempt cannot replace a newer token.
        if(signal.aborted)throw signal.reason||new DOMException('Read aborted','AbortError');
        cachedGoogleToken = {
          access_token: data.access_token,
          expires_at: Date.now() + data.expires_in * 1000,
        };
        return cachedGoogleToken.access_token;
      })
      .finally(() => {
        signal.removeEventListener('abort',cancel);
        if(googleTokenPromise===request)googleTokenPromise = null;
      });
    googleTokenPromise=request;
    signal.addEventListener('abort',cancel,{once:true});
  }
  return googleTokenPromise;
}

// Lets the shared header show the account photo on every service, including
// pages whose own sign-in handler does not render an avatar.
function announceUser(user) {
  window.__worksUser = user;
  window.dispatchEvent(new CustomEvent("works-user", { detail: user }));
}

export async function watchAuth({ onSignedIn, onSignedOut: pageSignedOut }) {
  const onSignedOut = (...args) => { announceUser(null); return pageSignedOut(...args); };
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
    announceUser({ picture: info.picture || "" });
    onSignedIn({ email: info.email, picture: info.picture });
  } catch (err) {
    // A speculative request can fail offline. Retry from a fresh frame if the
    // teacher actually opens it, without signing the foreground service out.
    if (window.frameElement?.hasAttribute('data-preloading')) {
      parent.dispatchEvent(new CustomEvent('works-preload-failed', {detail:window.frameElement}));
      return;
    }
    sessionToken = null;
    cachedGoogleToken = null;
    clearStoredSession();
    onSignedOut(null);
  }
}

// iOSでホーム画面に追加したアイコンから起動した状態(navigator.standalone)だと、
// Googleへのリダイレクトが埋め込みブラウザ扱いされ、ログインがブロックされることがある
// (Googleのポリシーによるもので、こちら側では回避できない)。
// その場合はSafariで直接開いてログインしてもらうよう案内する。
export function isStandaloneHomeScreenApp() {
  return Boolean(window.navigator.standalone);
}

export function signIn(redirectPath) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(redirectPath),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // 毎回同意画面を出すことで、確実にrefresh_tokenを取得し直せるようにする。
    prompt: "consent",
    login_hint: ALLOWED_EMAIL,
  });
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

  if (isStandaloneHomeScreenApp()) {
    // ホーム画面のアイコン(Web Clip)は複数ウィンドウを持てないため、
    // window.openで新規ウィンドウ扱いにするとiOSがSafari本体へ処理を渡すことが多い。
    // これによりGoogle側の埋め込みブラウザ判定(ログインブロック)を回避しやすくなる。
    // ログイン完了後はセッションがlocalStorageに保存され、同一オリジンなので
    // 元のホーム画面アイコンからも引き続き使える。
    window.open(authUrl, "_blank");
    return;
  }

  window.location.href = authUrl;
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
