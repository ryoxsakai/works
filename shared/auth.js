import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, ALLOWED_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// Firebaseのセッションはリロード後も残るが、Googleのアクセストークンはメモリ上にしか保持しないため
// カレンダーAPIを叩くには再ログインのたびに取り直しになる(単一ユーザー運用なので許容)。
let googleAccessToken = null;
let redirectError = null;
let redirectResultReceived = false;

// signInWithPopupはモバイルブラウザだとポップアップのライフサイクルが不安定で
// auth/cancelled-popup-request 等が起きやすいため、リダイレクト方式を使う。
// ログイン後にこのページへ戻ってきた時点でここが実行され、結果を受け取る。
const redirectResultPromise = getRedirectResult(auth)
  .then((result) => {
    if (result) {
      redirectResultReceived = true;
      const credential = GoogleAuthProvider.credentialFromResult(result);
      googleAccessToken = credential?.accessToken ?? null;
    }
  })
  .catch((err) => {
    redirectError = err;
  });

export function getGoogleAccessToken() {
  return googleAccessToken;
}

// 一時的な調査用: リダイレクト認証がどこで止まっているかを画面表示するための情報。
export async function getDebugInfo() {
  await redirectResultPromise;
  return {
    href: location.href,
    authDomain: firebaseConfig.authDomain,
    indexedDBAvailable: typeof indexedDB !== "undefined",
    cookieEnabled: navigator.cookieEnabled,
    redirectResultReceived,
    redirectError: redirectError
      ? { code: redirectError.code, message: redirectError.message }
      : null,
    currentUser: auth.currentUser
      ? { email: auth.currentUser.email, uid: auth.currentUser.uid }
      : null,
  };
}

export async function watchAuth({ onSignedIn, onSignedOut, onRejected }) {
  await redirectResultPromise;

  onAuthStateChanged(auth, (user) => {
    if (redirectError) {
      onSignedOut(`リダイレクトエラー: ${redirectError.code || redirectError.message}`);
      return;
    }
    if (user && user.email?.toLowerCase() === ALLOWED_EMAIL.toLowerCase()) {
      onSignedIn(user);
      return;
    }
    if (user) {
      signOut(auth);
      if (onRejected) onRejected(user.email);
      onSignedOut(`許可されていないアカウントです: ${user.email}`);
      return;
    }
    onSignedOut(
      redirectResultReceived
        ? "リダイレクト後にユーザー情報が取得できませんでした"
        : null
    );
  });
}

export function signIn() {
  const provider = new GoogleAuthProvider();
  provider.addScope("https://www.googleapis.com/auth/calendar.readonly");
  provider.setCustomParameters({ login_hint: ALLOWED_EMAIL });
  return signInWithRedirect(auth, provider);
}

export function signOutUser() {
  googleAccessToken = null;
  return signOut(auth);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) throw new Error("not signed in");
  return user.getIdToken();
}
